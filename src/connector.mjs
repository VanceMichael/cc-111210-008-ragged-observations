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
export function readDataset(bytes) {
  const header = readHeader(bytes); let offset = header.headerOffset;
  const word = () => { if(offset+4>bytes.length)throw new Error('变量头截断');const value=bytes.readUInt32BE(offset);offset+=4;return value; };
  const name = () => { const size=word();if(offset+size>bytes.length)throw new Error('变量名截断');const value=bytes.subarray(offset,offset+size).toString('utf8');offset+=aligned(size);return value; };
  const widths = {1:1,2:1,3:2,4:4,5:4,6:8};
  function values(type,count,start) {
    const width=widths[type];if(!width||start+count*width>bytes.length)throw new Error('变量数据截断');
    if(type===2)return bytes.subarray(start,start+count).toString('utf8');
    return Array.from({length:count},(_,index)=>{const at=start+index*width;return type===1?bytes.readInt8(at):type===3?bytes.readInt16BE(at):type===4?bytes.readInt32BE(at):type===5?bytes.readFloatBE(at):bytes.readDoubleBE(at);});
  }
  function attrs(){const tag=word();const count=word();if(tag!==12&&!(tag===0&&count===0))throw new Error('属性列表无效');const output={};for(let index=0;index<count;index++){const key=name();const type=word();const size=word();output[key]={type,value:values(type,size,offset)};offset+=aligned(size*widths[type]);}return output;}
  const attributes=attrs();const tag=word();const count=word();if(tag!==11&&!(tag===0&&count===0))throw new Error('变量列表无效');const variables=[];
  for(let index=0;index<count;index++){const variableName=name();const dimensions=Array.from({length:word()},()=>word());const attributes=attrs();const type=word();const size=word();const begin=word();variables.push({name:variableName,dimensions,attributes,type,size,begin});}
  return { ...header, attributes, variables, readVariable(variableName,start=0,count=undefined){const variable=variables.find(item=>item.name===variableName);if(!variable)throw new Error('变量不存在');const total=variable.dimensions.reduce((product,index)=>product*header.dimensions[index].size,1);count??=total-start;if(!Number.isInteger(start)||!Number.isInteger(count)||start<0||count<0||start+count>total)throw new Error('变量切片越界');return values(variable.type,count,variable.begin+start*widths[variable.type]);} };
}
export async function inspect(base,options={}){const response=await get(base,'/file?kind='+(options.kind??'contiguous'));const bytes=Buffer.from(await response.arrayBuffer());const dataset=readDataset(bytes);return {dimensions:dataset.dimensions,variables:dataset.variables,temperature:dataset.readVariable('temperature'),bytes:bytes.length};}
