{
  description = "dead-claude-skills: dev shell, pre-commit checks and a home-manager module for the plugins' external tools";

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
        runtimeInputs = with pkgs; [bash coreutils diffutils gawk gnugrep gnused jq];
        text = ''exec bash scripts/check-repo.sh'';
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
            files = "^(\\.claude-plugin/|plugins/|INSTALL\\.md$|scripts/check-repo\\.sh$)";
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
        packages = with pkgs; [git gh jq perl shellcheck];
      };
    });

    formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.alejandra);

    homeManagerModules = {
      default = import ./nix/home-manager.nix;
      dead-claude-skills = self.homeManagerModules.default;
    };
  };
}
