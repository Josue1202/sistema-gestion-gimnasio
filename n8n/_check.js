const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'workflows');
let bad = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const wf = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const node of wf.nodes) {
    const code = node.parameters && node.parameters.jsCode;
    if (!code) continue;
    try { new Function(code); }
    catch (e) { bad++; console.log(`JS ERROR  ${f} / ${node.name}: ${e.message}`); }
  }
  const names = new Set(wf.nodes.map((n) => n.name));
  for (const src of Object.keys(wf.connections)) {
    if (!names.has(src)) { bad++; console.log(`CONN ERROR ${f}: origen '${src}' no existe`); }
    for (const grp of wf.connections[src].main) for (const c of grp) {
      if (!names.has(c.node)) { bad++; console.log(`CONN ERROR ${f}: destino '${c.node}' no existe`); }
    }
  }
  console.log(`ok  ${f}  (${wf.nodes.length} nodos)`);
}
console.log(bad ? `\n${bad} problema(s)` : '\nTodo OK');
