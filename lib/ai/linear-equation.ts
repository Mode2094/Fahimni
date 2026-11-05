/** Deliberately bounded: one variable term, numeric constant and numeric RHS.
 * Unsupported algebra is left to the general tutor, never partially parsed. */
export function linearEquationFacts(text:string){
 // Recognized questions may wrap an otherwise simple equation in display
 // delimiters. Strip only those delimiters for parsing; never rewrite display.
 const normalized=text.replace(/\\\(|\\\)|\\\[|\\\]|\$/g,' ').replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[−–—]/g,'-').replace(/٫/g,'.');
 if(/(?:[xس]\s*(?:\^|²|³)|\d\s*[xس].*[xس]\s*=)/i.test(normalized))return null;
 const m=/(?:^|[\s:،])([+-]?\s*(?:\d+(?:\.\d+)?)?)\s*[xس]\s*(?:([+-])\s*(\d+(?:\.\d+)?))?\s*=\s*([+-]?\s*\d+(?:\.\d+)?)(?![\d.])/.exec(normalized);
 if(!m||/^\s*(?:[xس\d.+*/^=-]|[−–])/i.test(normalized.slice(m.index+m[0].length)))return null;
 const coefficient=m[1].replace(/\s/g,'');
 const a=coefficient===''||coefficient==='+'?1:coefficient==='-'?-1:Number(coefficient);
 const b=m[3]?Number(m[3])*(m[2]==='-'?-1:1):0,c=Number(m[4].replace(/\s/g,''));
 if(![a,b,c].every(Number.isFinite)||a===0||Math.max(Math.abs(a),Math.abs(b),Math.abs(c))>1e9)return null;
 const x=(c-b)/a;
 return {a,b,c,x};
}

export function fractionLatex(numerator:number,denominator:number):string{
 const places=(v:number)=>{const [m,e='0']=String(v).split('e');return Math.max(0,(m.split('.')[1]?.length??0)-Number(e));};
 const scale=10**Math.min(12,Math.max(places(numerator),places(denominator)));
 let n=Math.round(numerator*scale),d=Math.round(denominator*scale);
 const gcd=(a:number,b:number):number=>b?gcd(b,a%b):Math.abs(a);
 const divisor=gcd(n,d);n/=divisor;d/=divisor;
 const sign=n*d<0?'-':'';
 return Math.abs(d)===1?`${sign}${Math.abs(n)}`:`${sign}\\frac{${Math.abs(n)}}{${Math.abs(d)}}`;
}

export function linearNotation(facts:NonNullable<ReturnType<typeof linearEquationFacts>>){
 const {a,b,c}=facts,term=`${a===1?'':a===-1?'-':a}x`,constant=b===0?'':b>0?`+${b}`:String(b),solution=fractionLatex(c-b,a);
 const subtract=b<0?`+${-b}`:`-${b}`;
 return {
  equation:`${term}${constant}=${c}`,
  balance:`${term}${constant}${subtract}=${c}${subtract}`,
  isolate:`${term}=${c-b}`,
  divide:`x=\\frac{${c-b}}{${a}}`,
  solution:`x=${solution}`,
  check:`${a}\\left(${solution}\\right)${constant}=${c}`,
 };
}
