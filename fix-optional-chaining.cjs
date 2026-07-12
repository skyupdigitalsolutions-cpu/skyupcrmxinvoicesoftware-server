// One-off repair: undo a formatter that split optional chaining ("?." -> "? .").
// Run from the server project root:   node fix-optional-chaining.cjs
// Safe to re-run. Leaves real ternaries (a ? b : c) and decimals (x ? .5) alone.
const fs = require('fs');
const path = require('path');

let fixed = 0;

function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
        const fp = path.join(dir, name);
        const st = fs.statSync(fp);
        if (st.isDirectory()) {
            if (name !== 'node_modules' && name !== '.git') walk(fp);
        } else if (/\.(m?js|cjs)$/.test(name)) {
            const src = fs.readFileSync(fp, 'utf8');
            const out = src.replace(/\?\s+\.(?=[A-Za-z_$(])/g, '?.');
            if (out !== src) {
                fs.writeFileSync(fp, out);
                fixed++;
                console.log('fixed:', fp);
            }
        }
    }
}

walk(path.join(process.cwd(), 'src'));
console.log(`\nDone. Files fixed: ${fixed}`);