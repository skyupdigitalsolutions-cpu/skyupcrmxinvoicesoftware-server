// repair-optional-chaining.cjs
// Fixes "?." -> "? ." and "??" -> "? ?" corruption introduced by a bad script.
// Usage: node repair-optional-chaining.cjs <file1> <file2> ...
//   or:  node repair-optional-chaining.cjs --all   (scans src/ recursively for .js files)

const fs = require('fs');
const path = require('path');

function fixContent(content) {
    let fixed = content;
    // Nullish coalescing: "? ?" -> "??" (do this BEFORE the optional-chaining fix,
    // since "? ?" would otherwise partially match the "?." pattern below)
    fixed = fixed.replace(/\?\s+\?/g, '??');
    // Optional chaining: "? ." -> "?."
    fixed = fixed.replace(/\?\s+\./g, '?.');
    // Broken numeric separator seen in one file: "3 _000_000" -> "3_000_000"
    fixed = fixed.replace(/(\d)\s+_(\d)/g, '$1_$2');
    return fixed;
}

function collectJsFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectJsFiles(full, out);
        else if (entry.name.endsWith('.js') || entry.name.endsWith('.cjs')) out.push(full);
    }
    return out;
}

const args = process.argv.slice(2);
let files;
if (args[0] === '--all') {
    files = collectJsFiles(path.join(process.cwd(), 'src'));
} else if (args.length > 0) {
    files = args;
} else {
    console.error('Usage: node repair-optional-chaining.cjs <file1> <file2> ...  OR  --all');
    process.exit(1);
}

let changedCount = 0;
for (const file of files) {
    if (!fs.existsSync(file)) {
        console.warn(`SKIP (not found): ${file}`);
        continue;
    }
    const original = fs.readFileSync(file, 'utf8');
    const fixed = fixContent(original);
    if (fixed !== original) {
        fs.writeFileSync(file, fixed, 'utf8');
        console.log(`FIXED: ${file}`);
        changedCount++;
    } else {
        console.log(`OK (no change needed): ${file}`);
    }
}
console.log(`\nDone. ${changedCount} file(s) modified.`);