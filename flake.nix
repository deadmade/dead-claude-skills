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

    # Upstream files copied by scripts/sync-*.sh: fixing them here would churn every sync PR.
    vendored = ["^plugins/(dead-skills/skills/hallmark|mattpocock-picks|pstack-picks|graphify)/"];

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
        text = ''exec node --test 'installer/*.test.mjs' '';
      };

      dev-feature-guard-test = pkgs.writeShellApplication {
        name = "dev-feature-guard-test";
        runtimeInputs = with pkgs; [git nodejs];
        text = ''exec node --test scripts/dev-feature-guard.test.mjs'';
      };
    in
      git-hooks.lib.${system}.run {
        src = ./.;
        hooks = {
          alejandra.enable = true;
          check-merge-conflicts.enable = true;
          check-json.enable = true;
          shellcheck = {
            enable = true;
            excludes = vendored ++ ["^\\.envrc$"];
          };
          end-of-file-fixer = {
            enable = true;
            excludes = vendored;
          };
          plugin-validate = {
            enable = true;
            name = "claude plugin validate + marketplace consistency";
            entry = "${check-repo}/bin/check-repo";
            files = "^(\\.claude-plugin/|plugins/|scripts/check-repo\\.mjs$)";
            pass_filenames = false;
          };
          installer-test = {
            enable = true;
            name = "installer tests";
            entry = "${installer-test}/bin/installer-test";
            files = "^(installer/|package\\.json$)";
            pass_filenames = false;
          };
          dev-feature-guard = {
            enable = true;
            name = "dev-feature lock tests";
            entry = "${dev-feature-guard-test}/bin/dev-feature-guard-test";
            files = "^(plugins/dead-skills/hooks/|scripts/dev-feature-guard\\.test\\.mjs$)";
            pass_filenames = false;
          };
        };
      };
  in {
    checks = forAllSystems (system: {pre-commit = preCommit system;});

    devShells = forAllSystems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
      pre-commit = self.checks.${system}.pre-commit;
    in {
      default = pkgs.mkShell {
        inherit (pre-commit) shellHook;
        buildInputs = pre-commit.enabledPackages;
        # What scripts/sync-*.sh and the workflows use besides stdenv.
        packages = with pkgs; [git gh jq perl shellcheck nodejs_24];
      };
    });

    formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.alejandra);
  };
}
