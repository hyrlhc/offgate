// Adim adim, okunabilir terminal ciktisi.
// P6'daki arayuzun adim listesi bununla birebir ayni sirayi izleyecek.
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

let stepNo = 0;

export function step(title) {
  stepNo += 1;
  process.stdout.write(`\n${C.bold}${C.cyan}[${stepNo}] ${title}${C.reset}\n`);
}
export function ok(msg) { console.log(`  ${C.green}✓${C.reset} ${msg}`); }
export function info(msg) { console.log(`  ${C.dim}·${C.reset} ${msg}`); }
export function warn(msg) { console.log(`  ${C.yellow}!${C.reset} ${msg}`); }
export function fail(msg) { console.log(`  ${C.red}✗${C.reset} ${msg}`); }
export function header(msg) { console.log(`\n${C.bold}${msg}${C.reset}`); }
export function link(label, url) { console.log(`  ${C.dim}${label}:${C.reset} ${url}`); }
export function resetSteps() { stepNo = 0; }
