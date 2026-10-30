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
    vendored = ["^plugins/flows/packs/" "^plugins/flows/agents/" "^plugins/shared/graphify/" "^plugins/opt-in/hallmark/" "^plugins/opt-in/implementation/(rust|csharp)-skills/(library/|skills/|LICENSE$|UPSTREAM$)" "^plugins/opt-in/implementation/postgres/skills/" "^plugins/flows/skills/self-review/(LICENSE|references/upstream/)"];

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
          exec node --test 'scripts/*.test.mjs' 'plugins/default/hooks/*.test.mjs' 'plugins/flows/hooks/*.test.mjs' 'plugins/opt-in/headroom-trim/hooks/*.test.mjs'
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
            files = "^(installer/|scripts/|crates/|plugins/default/hooks/|plugins/flows/hooks/|plugins/opt-in/headroom-trim/hooks/|plugins/flows/skills/|\\.claude-plugin/marketplace\\.json$|package\\.json$)";
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
    });

    devShells = forAllSystems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
      pre-commit = self.checks.${system}.pre-commit;
    in {
      default = pkgs.mkShell {
        inherit (pre-commit) shellHook;
        buildInputs = pre-commit.enabledPackages;
        # What scripts/sync-*.mjs and the workflows use besides stdenv, and the Rust toolchain for tui-review's binary.
        packages = with pkgs; [git gh nodejs_26 uv cargo rustc clippy rustfmt rust-analyzer];
        RUST_SRC_PATH = "${pkgs.rustPlatform.rustLibSrc}";
      };
    });

    formatter = forAllSystems treefmt;
  };
}
