import { listen } from '../src/http.mjs';
const word=value=>{const bytes=Buffer.alloc(4);bytes.writeUInt32BE(value>>>0);return bytes;};
const string=value=>{const bytes=Buffer.from(value);return Buffer.concat([word(bytes.length),bytes,Buffer.alloc((4-bytes.length%4)%4)]);};
function attributes(items){return items.length?Buffer.concat([word(12),word(items.length),...items.map(([name,value])=>Buffer.concat([string(name),word(2),string(value)]))]):Buffer.alloc(8);}
function encode(kind){
  const indexed=kind==='indexed';const dimensions=[['station',2],['obs',5]];
  const variables=[{name:indexed?'stationIndex':'rowSize',dims:[indexed?1:0],type:4,values:indexed?[0,0,1,1,1]:kind==='broken'?[2,4]:[2,3],attrs:[[indexed?'instance_dimension':'sample_dimension',indexed?'station':'obs']]},{name:'time',dims:[1],type:4,values:[0,1,2,3,4],attrs:[['units','days since 2000-01-01'],['calendar','360_day']]},{name:'temperature',dims:[1],type:3,values:[100,110,-999,120,130],attrs:[['units','K']]},{name:'quality',dims:[1],type:4,values:[0,0,1,0,0],attrs:[['flag_meanings','good missing']]}];
  const global=attributes([['Conventions','CF-1.10'],['featureType','timeSeries'],['packing','temperature: _FillValue=-999; scale_factor=0.1; add_offset=273.15; valid_range=0,1000']]);
  const dimensionBytes=Buffer.concat([word(10),word(dimensions.length),...dimensions.map(([name,size])=>Buffer.concat([string(name),word(size)]))]);
  const prefix=Buffer.concat([Buffer.from('CDF\x01'),word(0),dimensionBytes,global]);
  function entries(offsets){return Buffer.concat([word(11),word(variables.length),...variables.map((variable,index)=>{const size=variable.values.length*(variable.type===3?2:4);return Buffer.concat([string(variable.name),word(variable.dims.length),...variable.dims.map(word),attributes(variable.attrs),word(variable.type),word(Math.ceil(size/4)*4),word(offsets[index]??0)]);})]);}
  let cursor=prefix.length+entries([]).length;const offsets=[];const payload=[];
  for(const variable of variables){offsets.push(cursor);const bytes=Buffer.alloc(Math.ceil(variable.values.length*(variable.type===3?2:4)/4)*4);variable.values.forEach((value,index)=>variable.type===3?bytes.writeInt16BE(value,index*2):bytes.writeInt32BE(value,index*4));payload.push(bytes);cursor+=bytes.length;}
  return Buffer.concat([prefix,entries(offsets),...payload]);
}
export async function startFixture(){return listen(async url=>url.pathname==='/file'?{type:'application/x-netcdf',body:encode(url.searchParams.get('kind')??'contiguous')}:{status:404,body:{}});}
