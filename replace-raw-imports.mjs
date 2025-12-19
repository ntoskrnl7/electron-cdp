import fs from 'node:fs';

const superJSONContent = fs.readFileSync('./esm/SuperJSON.browser.js', 'utf-8');

const cjsFiles = fs.readdirSync('.')
  .filter(file => file.endsWith('.js') && !file.startsWith('esm/') && file !== 'build-utils.mjs')
  .filter(file => {
    try {
      const content = fs.readFileSync(`./${file}`, 'utf-8');
      return content.includes('./superJSON.browser.js?raw');
    } catch {
      return false;
    }
  });

console.log(`Found ${cjsFiles.length} CJS files with ?raw import:`, cjsFiles);

cjsFiles.forEach(fileName => {
  try {
    let fileContent = fs.readFileSync(`./${fileName}`, 'utf-8');

    const escapedContent = superJSONContent
      .replaceAll('\\', '\\\\')
      .replaceAll('`', '\\`')
      .replaceAll('$', String.raw`\$`);

    fileContent = fileContent.replace(
      /const (\w+) = (__importDefault\w*)\(require\(".\/superJSON\.browser\.js\?raw"\)\);/,
      `const $1 = { default: \`${escapedContent}\` };`
    );

    fs.writeFileSync(`./${fileName}`, fileContent);

    console.log(`✅ ${fileName} updated: ?raw import replaced with inline content for CJS`);
  } catch (error) {
    console.log(`⚠️  ${fileName} error processing: ${error.message}`);
  }
});
