import { get } from './http.mjs';
function aligned(value) { return Math.ceil(value / 4) * 4; }
export function readHeader(bytes) {
  if (bytes.length < 12 || bytes.subarray(0,4).toString('hex') !== '43444601') throw new Error('不是CDF-1文件');
  let offset = 8;
  const integer = () => { if (offset+4>bytes.length) throw new Error('文件头截断'); const value=bytes.readUInt32BE(offset);offset+=4;return value; };
  const name = () => {const size=integer();if(offset+size>bytes.length)throw new Error('名称截断');const value=bytes.subarray(offset,offset+size).toString('utf8');offset+=aligned(size);return value;};
  const dimensions=[]; const tag=integer(); const count=integer(); if(tag!==10&&!(tag===0&&count===0))throw new Error('维度列表无效');
  for(let index=0;index<count;index++)dimensions.push({name:name(),size:integer()});
  return {records:bytes.readUInt32BE(4),dimensions,headerOffset:offset};
}
export async function inspect(base,options={}){const response=await get(base,'/file?kind='+(options.kind??'contiguous'));const bytes=Buffer.from(await response.arrayBuffer());return {...readHeader(bytes),bytes:bytes.length};}
