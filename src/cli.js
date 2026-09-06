import { scanWorkspace } from './scanner/scanner.js';
import { mergeSharedLibrary, writeLibrary } from './model/library.js';
import { loadThemes, saveTheme } from './themes/store.js';
import { createPlan } from './planner/planner.js';
import { applyPlan } from './apply/apply.js';
import { startServer } from './server.js';
import { resolveWorkspaceConfig, parseArgs } from './utils/cli.js';
import { loadVariantAssignments } from './variant-store.js';
import { loadSharedImport } from './shared-import-store.js';
import { loadRecognitionState } from './recognition-store.js';
import { initializeStorage } from './storage/initialize.js';

async function main() {
  const [command = 'scan', ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const config = await resolveWorkspaceConfig(args);
  await initializeStorage(config);
  const scan = async () => {
    const library = await scanWorkspace(
      config.workspaceRoot,
      config.archiveRoot,
      await loadVariantAssignments(config.databasePath),
      await loadRecognitionState(config.databasePath)
    );
    const shared = await loadSharedImport(config.databasePath);
    return shared ? mergeSharedLibrary(library, shared.library) : library;
  };

  if (command === 'scan') {
    const library = await scan();
    await writeLibrary(config.databasePath, library);
    console.log(`library.sqlite updated in ${config.workspaceRoot}`);
    return;
  }

  if (command === 'apply') {
    const library = await scan();
    await writeLibrary(config.databasePath, library);
    const themes = await loadThemes(config.databasePath);
    const plan = createPlan(library, themes, config);
    await applyPlan(plan);
    console.log(`Reading export completed from ${config.workspaceRoot}`);
    return;
  }

  if (command === 'serve') {
    await startServer(config);
    return;
  }

  if (command === 'theme') {
    const [action = 'list'] = rest;
    const themes = await loadThemes(config.databasePath);
    if (action === 'list') {
      console.log(JSON.stringify(themes, null, 2));
      return;
    }
    if (action === 'save') {
      const fileName = args.fileName ?? 'Untitled';
      const episodes = args.episodes ? String(args.episodes).split(',').filter(Boolean) : [];
      await saveTheme(config.databasePath, { title: fileName, episodes });
      console.log(`theme saved: ${fileName}`);
      return;
    }
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.stack ?? error.message ?? String(error));
  process.exitCode = 1;
});
