import { getDefaultConfig } from "expo/metro-config";
import path from "path";

// Expo monorepo guide: make the workspace source packages (protocol/realtime/
// state) watchable and resolvable — they are symlinked via npm `file:` deps.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [path.resolve(workspaceRoot, "packages")];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

export default config;
