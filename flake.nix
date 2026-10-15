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
    forAllSystems = nixpkgs.lib.genAttrs ["x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin"];

    # Upstream files copied by scripts/sync-*.mjs: fixing them here would churn every sync PR.
    vendored = ["^plugins/(hallmark|paper-lookup|mattpocock-picks|pstack-picks|tob-picks|graphify)/" "^plugins/languages/[^/]+/(library/|skills/|LICENSE$|UPSTREAM$)" "^plugins/database/[^/]+/skills/" "^plugins/self-review/(LICENSE|agents/|skills/self-review/references/upstream/)"];

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
        text = ''exec node --test 'installer/*.test.mjs' 'scripts/*.test.mjs' '';
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
            files = "^(\\.claude-plugin/|plugins/|scripts/check-repo\\.mjs$|package\\.json$)";
            pass_filenames = false;
          };
          installer-test = {
            enable = true;
            name = "installer tests";
            entry = "${installer-test}/bin/installer-test";
            files = "^(installer/|scripts/|\\.claude-plugin/marketplace\\.json$|package\\.json$)";
            pass_filenames = false;
          };
        };
      };
  in {
    checks = forAllSystems (system: {pre-commit = preCommit system;});

    # brv, the tui-review plugin's Rust binary: `nix build .#brv`, or `nix run .#brv -- gen`. Its tests run in the build.
    packages = forAllSystems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
      manifest = (pkgs.lib.importTOML ./plugins/tui-review/brv/Cargo.toml).package;
    in {
      brv = pkgs.rustPlatform.buildRustPackage {
        pname = manifest.name;
        inherit (manifest) version;
        src = ./plugins/tui-review/brv;
        cargoLock.lockFile = ./plugins/tui-review/brv/Cargo.lock;
        # tests/review.rs builds its fixture repositories with git.
        nativeCheckInputs = [pkgs.git];
        meta = {
          inherit (manifest) description;
          mainProgram = "brv";
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
        # What scripts/sync-*.mjs and the workflows use besides stdenv, and the Rust toolchain for tui-review's brv.
        packages = with pkgs; [git gh nodejs_26 cargo rustc clippy rustfmt rust-analyzer];
        RUST_SRC_PATH = "${pkgs.rustPlatform.rustLibSrc}";
      };
    });

    formatter = forAllSystems treefmt;
  };
}
