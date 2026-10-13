import { describe, it, expect } from 'vitest';
// @ts-expect-error local JS recipe
import { createMachine } from '../extensions/space-browsa/ai-ui/program.mjs';
const program = (overrides = {}) => ({version:1,state:{n:0},views:[{id:'out',text:{state:'n'}}],events:[],...overrides});
describe('bounded model-authored program',()=>{
  it('computes nested precedence and reactive curves using generic expressions',()=>{
    let input='3';
    const m=createMachine(program({views:[{id:'out',text:['+',2,['*',3,4]]},{id:'chart',plot:['map',['range',4],'x',['array',{var:'x'},['*',{var:'x'},['num',{input:'gain'}]]]]}]}),()=>input);
    expect(m.render()[0].value).toBe(14);expect(m.render()[1].value[3]).toEqual([3,9]);input='5';expect(m.render()[1].value[3]).toEqual([3,15]);
  });
  it('runs arbitrary state recurrences, conditional loops, rollback and reset',()=>{
    const m=createMachine(program({tick:[{op:'set',key:'n',value:['+', ['*',{state:'n'},2],1]}],events:[{id:'many',event:'click',do:[{op:'repeat',count:3,var:'i',do:[{op:'set',key:'n',value:['+',{state:'n'},1]}]}]},{id:'bad',event:'click',do:[{op:'set',key:'n',value:9},{op:'set',key:'n',value:['/',1,0]}]}]}));
    expect(m.step()[0].value).toBe(1);expect(m.step()[0].value).toBe(3);expect(m.dispatch('many','click')[0].value).toBe(6);
    expect(()=>m.dispatch('bad','click')).toThrow();expect(m.snapshot().n).toBe(6);expect(m.reset()[0].value).toBe(0);
  });
  it('rejects host access, unknown programs and oversized allocations',()=>{
    for(const e of [['fetch','https://evil.example'],{state:'constructor'},{input:'__proto__'},['range',1e9],['pow',10,100],['while',true]]) expect(()=>createMachine(program({views:[{id:'out',text:e}]})).render()).toThrow();
    expect(()=>createMachine(program({version:2}))).toThrow();expect(()=>createMachine(program({state:JSON.parse('{"__proto__":1}')}))).toThrow();
    expect(()=>createMachine(program({events:[{id:'bad',event:'click',do:[{op:'repeat',count:257,var:'i',do:[]}]}]})).dispatch('bad','click')).toThrow();
  });
  it('caps nested work, values and expression depth',()=>{
    const m=createMachine(program({events:[{id:'bad',event:'click',do:[{op:'repeat',count:256,var:'i',do:[{op:'repeat',count:256,var:'j',do:[{op:'set',key:'n',value:['+',{state:'n'},1]}]}]}]}]}));
    expect(()=>m.dispatch('bad','click')).toThrow(/budget/);expect(m.snapshot().n).toBe(0);
    let e:any=0;for(let i=0;i<40;i++)e=['+',1,e];expect(()=>createMachine(program({views:[{id:'out',text:e}]}))).toThrow(/complexity/);
    const huge=Array.from({length:256},()=>Array.from({length:256},()=>0));expect(()=>createMachine(program({state:{n:huge}}))).toThrow(/size/);
  });
});
