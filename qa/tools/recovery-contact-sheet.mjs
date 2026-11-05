import sharp from 'sharp';
import {readdirSync,mkdirSync} from 'node:fs';
const root='docs/reviews/recovery/after';
const images=readdirSync(root).filter(name=>name.endsWith('.png')).sort();
mkdirSync('docs/reviews/recovery/contact-sheets',{recursive:true});
for(let offset=0;offset<images.length;offset+=12){
 const group=images.slice(offset,offset+12);
 const tiles=await Promise.all(group.map(async(name,index)=>{
  const thumb=await sharp(`${root}/${name}`).resize({width:300,height:400,fit:'contain',background:'#eeeef4'}).png().toBuffer();
  const label=Buffer.from(`<svg width="300" height="30"><rect width="300" height="30" fill="white"/><text x="8" y="20" font-family="Arial" font-size="11" fill="#222">${name}</text></svg>`);
  return[{input:label,left:(index%4)*300,top:Math.floor(index/4)*430},{input:thumb,left:(index%4)*300,top:Math.floor(index/4)*430+30}];
 }));
 await sharp({create:{width:1200,height:Math.ceil(group.length/4)*430,channels:3,background:'#eeeef4'}}).composite(tiles.flat()).png().toFile(`docs/reviews/recovery/contact-sheets/sheet-${offset/12+1}.png`);
}
console.log('contact sheets:',Math.ceil(images.length/12),'screenshots:',images.length);
