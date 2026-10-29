{
  description = "dead-claude-skills: dev shell and pre-commit checks";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    git-hooks = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = {
    self,
    nixpkgs,
    git-hooks,
  }: let
    forAllSystems = nixpkgs.lib.genAttrs ["x86_64-linux"];

    # Upstream files copied by scripts/sync-*.mjs: fixing them here would churn every sync PR.
    vendored = ["^plugins/flows/packs/" "^plugins/flows/agents/" "^plugins/shared/graphify/" "^plugins/opt-in/hallmark/" "^plugins/opt-in/implementation/(rust|csharp)-skills/(library/|skills/|LICENSE$|UPSTREAM$)" "^plugins/opt-in/implementation/postgres/skills/" "^plugins/flows/skills/self-review/(LICENSE|references/upstream/)" "^crates/flow-cockpit/bindings/" "^crates/flow-cockpit/app/shell/vendor/" "^crates/flow-cockpit/core/tests/fixtures/"];

    # treefmt with the formatters treefmt.toml names: `nix fmt` and the pre-commit hook.
    treefmt = system: let
      pkgs = nixpkgs.legacyPackages.${system};
    in
      pkgs.writeShellApplication {
        name = "treefmt";
        runtimeInputs = [pkgs.treefmt pkgs.alejandra pkgs.prettier pkgs.rustfmt];
        text = ''exec treefmt "$@"'';
      };

    preCommit = system: let
      pkgs = nixpkgs.legacyPackages.${system};

      check-repo = pkgs.writeShellApplication {
        name = "check-repo";
        runtimeInputs = [pkgs.nodejs];
        text = ''exec node scripts/check-repo.mjs'';
      };

      installer-test = pkgs.writeShellApplication {
        name = "installer-test";
        runtimeInputs = [pkgs.nodejs];
        text = ''
          node --test --experimental-test-coverage --test-coverage-include='installer/**' \
            --test-coverage-exclude='installer/**/*.test.ts' --test-coverage-lines=79 'installer/**/*.test.ts'
          exec node --test 'scripts/*.test.mjs' 'plugins/default/hooks/*.test.mjs'
        '';
      };
    in
      git-hooks.lib.${system}.run {
        src = ./.;
        hooks = {
          treefmt = {
            enable = true;
            package = treefmt system;
          };
          check-merge-conflicts.enable = true;
          check-json.enable = true;
          end-of-file-fixer = {
            enable = true;
            excludes = vendored;
          };
          plugin-validate = {
            enable = true;
            name = "claude plugin validate + marketplace consistency";
            entry = "${check-repo}/bin/check-repo";
            files = "^(\\.claude-plugin/|plugins/|crates/|scripts/check-repo\\.mjs$|package\\.json$)";
            pass_filenames = false;
          };
          installer-test = {
            enable = true;
            name = "installer tests";
            entry = "${installer-test}/bin/installer-test";
            files = "^(installer/|scripts/|crates/|plugins/default/hooks/|\\.claude-plugin/marketplace\\.json$|package\\.json$)";
            pass_filenames = false;
          };
        };
      };
  in {
    checks = forAllSystems (system: {pre-commit = preCommit system;});

    # The tui-review plugin's Rust binary: `nix build .#tui-review`, or `nix run .#tui-review -- gen`. Its tests run in the build.
    packages = forAllSystems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
      manifest = (pkgs.lib.importTOML ./crates/tui-review/Cargo.toml).package;
      webMcp = (pkgs.lib.importTOML ./crates/web-mcp/Cargo.toml).package;
      cockpit = (pkgs.lib.importTOML ./crates/flow-cockpit/Cargo.toml).workspace.package;
      cockpitApp = (pkgs.lib.importTOML ./crates/flow-cockpit/app/Cargo.toml).package;
    in {
      tui-review = pkgs.rustPlatform.buildRustPackage {
        pname = manifest.name;
        inherit (manifest) version;
        src = ./crates/tui-review;
        cargoLock.lockFile = ./crates/tui-review/Cargo.lock;
        # tests/review.rs builds its fixture repositories with git.
        nativeCheckInputs = [pkgs.git];
        meta = {
          inherit (manifest) description;
          mainProgram = "tui-review";
        };
      };
      # web-mcp, the web-mcp plugin's MCP server: `nix build .#web-mcp`.
      web-mcp = pkgs.rustPlatform.buildRustPackage {
        pname = webMcp.name;
        inherit (webMcp) version;
        src = ./crates/web-mcp;
        cargoLock.lockFile = ./crates/web-mcp/Cargo.lock;
        # Debug checks: the fetch tests' WEB_MCP_TEST_PUBLIC_IP hook exists only in debug builds or the `test-hooks` feature.
        checkType = "debug";
        meta = {
          inherit (webMcp) description;
          mainProgram = "web-mcp";
        };
      };
      # The flow cockpit window (Tauri, crates/flow-cockpit/app): `nix run .#flow-cockpit`, or the package in a system
      # config. It links the system's GTK and WebKit, so Linux gets it from here, not as a release download.
      flow-cockpit = pkgs.rustPlatform.buildRustPackage {
        pname = cockpitApp.name;
        inherit (cockpit) version;
        src = ./crates/flow-cockpit;
        cargoLock.lockFile = ./crates/flow-cockpit/Cargo.lock;
        buildAndTestSubdir = "app";
        nativeBuildInputs = with pkgs; [pkg-config wrapGAppsHook3];
        buildInputs = with pkgs; [webkitgtk_4_1 gtk3 libsoup_3 librsvg dbus];
        # These time the poll against file changes and the clock; they run in a local `cargo test`, not in the sandboxed
        # build.
        checkFlags = map (t: "--skip=${t}") ["poll_emits_once_per_change" "poll_sees_folders_created_later" "first_paint_before_link_scan"];
        meta = {
          inherit (cockpitApp) description;
          mainProgram = "flow-cockpit";
        };
      };
    });

    devShells = forAllSystems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
      pre-commit = self.checks.${system}.pre-commit;
    in {
      default = pkgs.mkShell {
        inherit (pre-commit) shellHook;
        buildInputs = pre-commit.enabledPackages;
        # What scripts/sync-*.mjs and the workflows use besides stdenv, the Rust toolchain for the crates, and the
        # libraries the flow cockpit window builds against.
        packages = with pkgs; [git gh nodejs_26 cargo rustc clippy rustfmt rust-analyzer pkg-config webkitgtk_4_1 gtk3 libsoup_3 librsvg dbus];
        RUST_SRC_PATH = "${pkgs.rustPlatform.rustLibSrc}";
      };
    });

    formatter = forAllSystems treefmt;
  };
}
