// Filesystem-only macOS JavaScript for Automation. Called by the installer.
ObjC.import('Foundation');

function run(argv) {
  if (argv.length !== 2 || !/^[a-p]{32}$/.test(argv[1])) throw new Error('A valid extension folder and ID are required.');
  const folder = ObjC.unwrap($(argv[0]).stringByStandardizingPath.stringByResolvingSymlinksInPath);
  if (!$.NSFileManager.defaultManager.fileExistsAtPath(folder + '/manifest.json')) throw new Error('The v3 extension folder is missing its manifest.json.');
  const payload = {format: 'meowcheats-keyboard-setup', version: 1, extensionId: argv[1]};
  const destination = folder + '/setup-' + argv[1] + '.json';
  const data = $(JSON.stringify(payload, null, 2) + '\n').dataUsingEncoding($.NSUTF8StringEncoding);
  if (!data.writeToFileAtomically(destination, true)) throw new Error('Could not save setup details inside v3. Move the project to a writable folder and try again.');
  return 'Setup file: ' + destination;
}
