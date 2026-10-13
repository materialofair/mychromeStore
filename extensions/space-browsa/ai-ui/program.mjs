// A small data language, not JavaScript: no eval, property traversal or host objects.
export const LIMITS = Object.freeze({ steps: 12000, items: 256, depth: 32, text: 2000, state: 32000 });
const key = x => typeof x === 'string' && /^[a-zA-Z][\w-]{0,63}$/.test(x) && !['constructor','prototype','__proto__'].includes(x);
const fail = message => { throw new Error(message); };
function value(x, depth = 0, budget = {left:4096}) {
  if (--budget.left < 0) fail('Value size limit');
  if (depth > 8) fail('Value nesting limit');
  if (typeof x === 'number') { if (!Number.isFinite(x) || Math.abs(x) > 1e12) fail('Numeric limit'); return x; }
  if (typeof x === 'string') { if (x.length > LIMITS.text) fail('Text limit'); return x; }
  if (x === null || typeof x === 'boolean') return x;
  if (Array.isArray(x) && x.length <= LIMITS.items) return x.map(v => value(v, depth + 1, budget));
  fail('Only bounded primitive values and arrays are supported');
}
function list(x, max = 64) { if (!Array.isArray(x) || x.length > max) fail('List limit'); return x; }
function fields(x, required, optional = []) {
  if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).some(k => !required.includes(k) && !optional.includes(k)) || required.some(k => !Object.hasOwn(x,k))) fail('Invalid program schema');
}
export function validateProgram(p) {
  fields(p, ['version','state','views','events'], ['tick']);
  if (p.version !== 1) fail('Unsupported program version');
  if (!p.state || Array.isArray(p.state) || typeof p.state !== 'object' || Object.keys(p.state).length > 64) fail('State limit');
  for (const [k,v] of Object.entries(p.state)) { if (!key(k)) fail('Invalid state key'); value(v); }
  if (JSON.stringify(p.state).length > LIMITS.state) fail('State size limit');
  for (const view of list(p.views)) { fields(view,['id'],['text','plot']); if (!key(view.id) || (Object.hasOwn(view,'text') === Object.hasOwn(view,'plot'))) fail('Invalid view'); }
  for (const e of list(p.events)) { fields(e,['id','event','do']); if (!key(e.id) || !['click','input','change','submit'].includes(e.event)) fail('Invalid event'); list(e.do); }
  if (p.tick) list(p.tick);
  // Validate total tree before recursion; unknown expression operators fail when evaluated.
  let count = 0;
  const walk = (x,d) => { if (++count > 6000 || d > LIMITS.depth) fail('Program complexity limit'); if (x && typeof x === 'object') for (const v of Object.values(x)) walk(v,d+1); };
  walk(p,0); return p;
}
export function createMachine(program, readInput = () => '') {
  const p = validateProgram(program);
  let state = structuredClone(p.state), remaining, deadline;
  function burn(d) { if (--remaining < 0 || d > LIMITS.depth || performance.now() > deadline) fail('Execution budget exceeded'); }
  const number = x => { if (typeof x !== 'number') fail('Expected number; use num for inputs'); return x; };
  function expr(x, vars = Object.create(null), d = 0) {
    burn(d);
    if (x === null || ['string','boolean','number'].includes(typeof x)) return value(x);
    if (!Array.isArray(x)) {
      if (!x || Object.keys(x).length !== 1) fail('Invalid reference');
      if (Object.hasOwn(x,'state') && key(x.state) && Object.hasOwn(state,x.state)) return state[x.state];
      if (Object.hasOwn(x,'input') && key(x.input)) return value(readInput(x.input));
      if (Object.hasOwn(x,'var') && key(x.var) && Object.hasOwn(vars,x.var)) return vars[x.var];
      fail('Unknown reference');
    }
    const [op,...args] = x, ev = a => expr(a,vars,d+1);
    if(typeof op !== 'string') fail('Invalid operator');
    const arity = n => { if (args.length !== n) fail('Invalid operator arity'); };
    if (op === 'if') { arity(3); return ev(args[0]) ? ev(args[1]) : ev(args[2]); }
    if (op === 'array') return value(list(args,256).map(ev));
    if (op === 'range') { arity(1); const n = number(ev(args[0])); if (!Number.isInteger(n) || n < 0 || n > LIMITS.items) fail('Range limit'); return Array.from({length:n},(_,i)=>i); }
    if (op === 'map') { arity(3); const a = list(ev(args[0]),256), name = args[1]; if (!key(name)) fail('Invalid variable'); return value(a.map(v => expr(args[2], Object.assign(Object.create(null),vars,{[name]:v}),d+1))); }
    if (op === 'at') { arity(2); const a = list(ev(args[0]),256), i = number(ev(args[1])); if (!Number.isInteger(i) || i < 0 || i >= a.length) fail('Index out of range'); return a[i]; }
    if (op === 'len' || op === 'sum') { arity(1); const a = list(ev(args[0]),256); return op === 'len' ? a.length : value(a.reduce((s,v)=>s+number(v),0)); }
    if (op === 'concat') { const vals = list(args).map(ev); if (vals.some(v=> typeof v === 'object' && v !== null)) fail('Concat needs scalar values'); return value(vals.join('')); }
    if (op === 'num') { arity(1); const v = ev(args[0]); if (!['string','number'].includes(typeof v) || String(v).trim() === '') fail('Invalid numeric input'); return value(Number(v)); }
    if (op === 'not') { arity(1); return !ev(args[0]); }
    const unary = {abs:Math.abs,round:Math.round,floor:Math.floor,ceil:Math.ceil,sqrt:Math.sqrt,sin:Math.sin,cos:Math.cos,exp:Math.exp,log:Math.log};
    if (Object.hasOwn(unary,op)) { arity(1); return value(unary[op](number(ev(args[0])))); }
    const binary = {'+':(a,b)=>a+b,'-':(a,b)=>a-b,'*':(a,b)=>a*b,'/':(a,b)=>a/b,'%':(a,b)=>a%b,pow:Math.pow,min:Math.min,max:Math.max};
    if (Object.hasOwn(binary,op)) { arity(2); return value(binary[op](number(ev(args[0])),number(ev(args[1])))); }
    const compare = {'==':(a,b)=>a===b,'<':(a,b)=>a<b,'>':(a,b)=>a>b,'<=':(a,b)=>a<=b,'>=':(a,b)=>a>=b};
    if (Object.hasOwn(compare,op)) { arity(2); const a=ev(args[0]),b=ev(args[1]); if (typeof a !== typeof b || typeof a === 'object') fail('Compare needs scalar values'); return compare[op](a,b); }
    fail('Unsupported operator: ' + String(op).slice(0,40));
  }
  function actions(commands, vars = Object.create(null), d = 0) {
    for (const c of list(commands)) {
      burn(d);
      if (c?.op === 'set') { fields(c,['op','key','value']); if (!key(c.key) || !Object.hasOwn(state,c.key)) fail('Unknown state key'); state[c.key]=value(expr(c.value,vars,d+1)); }
      else if (c?.op === 'if') { fields(c,['op','test','then'],['else']); actions(expr(c.test,vars,d+1) ? c.then : c.else || [],vars,d+1); }
      else if (c?.op === 'repeat') { fields(c,['op','count','var','do']); const n=number(expr(c.count,vars,d+1)); if (!Number.isInteger(n) || n<0 || n>256 || !key(c.var)) fail('Repeat limit'); for(let i=0;i<n;i++) actions(c.do,Object.assign(Object.create(null),vars,{[c.var]:i}),d+1); }
      else fail('Unsupported action');
      if (JSON.stringify(state).length > LIMITS.state) fail('State size limit');
    }
  }
  function transact(commands = []) {
    const old = structuredClone(state); remaining=LIMITS.steps;deadline=performance.now()+50;
    try {
      actions(commands);
      return p.views.map(v => {
        const kind = Object.hasOwn(v,'text') ? 'text' : 'plot';
        const result=expr(v[kind]);
        if (kind === 'text' && (Array.isArray(result) || String(result).length>2000)) fail('Text view limit');
        if (kind === 'plot') for (const point of list(result,256)) { if (!Array.isArray(point) || point.length!==2) fail('Plot expects [x,y] pairs'); point.forEach(number); }
        return {id:v.id,kind,value:result};
      });
    } catch(e) { state=old; throw e; }
  }
  return { render:()=>transact(), dispatch:(id,event)=>transact(p.events.filter(e=>e.id===id && e.event===event).flatMap(e=>e.do)), step:()=>transact(p.tick || []), reset:()=>{state=structuredClone(p.state);return transact();}, snapshot:()=>structuredClone(state), hasTick:!!p.tick?.length };
}
