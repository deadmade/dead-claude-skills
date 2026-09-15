# External tools the dead-claude-skills plugins expect on PATH. The plugins themselves come from setup.sh
# or /plugin: this module deliberately leaves programs.claude-code.settings and .marketplaces alone, since
# either turns ~/.claude/settings.json into a read-only store link and /plugin install can no longer save
# enabledPlugins.
{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.programs.dead-claude-skills;
  ls = cfg.languageServers;

  server = description:
    lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Install ${description} for the matching *-lsp plugin.";
    };
in {
  options.programs.dead-claude-skills = {
    enable = lib.mkEnableOption "the external tools used by the dead-claude-skills plugins";

    languageServers = {
      rust = server "rust-analyzer";
      csharp = server "csharp-ls and the .NET SDK";
      typescript = server "typescript-language-server and TypeScript";
      python = server "pyright";
      nix = server "nixd";
    };

    mcpAzure.enable = lib.mkEnableOption "Node.js for the mcp-azure plugin's npx server";

    graphify.enable = lib.mkEnableOption "uv, to install the graphify CLI (uv tool install graphifyy)";
  };

  config = lib.mkIf cfg.enable {
    home.packages =
      lib.optional ls.rust pkgs.rust-analyzer
      ++ lib.optionals ls.csharp [pkgs.csharp-ls pkgs.dotnet-sdk]
      ++ lib.optionals ls.typescript [pkgs.typescript-language-server pkgs.typescript]
      ++ lib.optional ls.python pkgs.pyright
      ++ lib.optional ls.nix pkgs.nixd
      ++ lib.optional cfg.mcpAzure.enable pkgs.nodejs_20
      ++ lib.optional cfg.graphify.enable pkgs.uv;
  };
}
