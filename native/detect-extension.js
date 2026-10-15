// Run with macOS JavaScript for Automation. Reads profile settings only;
// never changes browser preferences or grants access based on a display name.
ObjC.import('Foundation');

function run(argv) {
  if (!argv[0]) throw new Error('Provide the extension folder to detect.');
  const files = $.NSFileManager.defaultManager;
  const normalize = value => ObjC.unwrap($(value).stringByStandardizingPath.stringByResolvingSymlinksInPath);
  const extensionPath = normalize(argv[0]);
  const support = argv[1] || ObjC.unwrap($.NSHomeDirectory()) + '/Library/Application Support';
  const readJSON = path => {
    try {
      return JSON.parse(ObjC.unwrap($.NSString.alloc.initWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null)));
    }
    catch (_) { return null; }
  };
  const browsers = {chrome: 'Google/Chrome', edge: 'Microsoft Edge', chromium: 'Chromium', testing: 'Google/ChromeForTesting'};
  const matches = [];
  for (const browser of Object.keys(browsers)) {
    const base = support + '/' + browsers[browser];
    const profiles = ObjC.deepUnwrap(files.contentsOfDirectoryAtPathError(base, null)) || [];
    const ids = new Set();
    for (const profile of profiles) {
      for (const filename of ['Preferences', 'Secure Preferences']) {
        const path = base + '/' + profile + '/' + filename;
        if (!files.fileExistsAtPath(path)) continue;
        const preferences = readJSON(path);
        const settings = preferences && preferences.extensions && preferences.extensions.settings;
        for (const id of Object.keys(settings || {})) {
          const entry = settings[id];
          if (/^[a-p]{32}$/.test(id) && entry && typeof entry.path === 'string' && entry.path.startsWith('/') &&
              normalize(entry.path) === extensionPath) ids.add(id);
        }
      }
    }
    for (const id of ids) matches.push({browser, id});
  }
  // One host registration serves every profile in a browser. Refuse to
  // overwrite one ID with another when browser profiles disagree. Saved JSON
  // files are output only; editing one cannot authorize a different extension.
  for (const browser of Object.keys(browsers)) {
    if (matches.filter(match => match.browser === browser).length > 1) {
      throw new Error('Multiple MeowCheats IDs found in ' + browser + '. Use the manual installer command with the ID from your extension menu.');
    }
  }
  return matches.map(match => match.browser + '\t' + match.id).join('\n');
}
