const express = require('express');
const multer = require('multer');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const packer = require('./obfuscator/packer');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));
app.use(express.json());

function lightObfuscate(code) {
  const strings = [];
  const stringRegex = /(["'])(?:(?=(\\?))\2.)*?\1/g;
  let match;
  while ((match = stringRegex.exec(code)) !== null) {
    strings.push(match[0]);
  }
  const unique = [...new Set(strings)];
  const key = crypto.randomBytes(4).readUInt32LE(0);
  const keyByte = key & 0xFF;
  const tableEntries = {};
  unique.forEach((s, i) => {
    const content = s.slice(1, -1);
    const encrypted = [...content].map(c => String.fromCharCode(c.charCodeAt(0) ^ keyByte)).join('');
    tableEntries[i + 1] = encrypted;
  });
  let tableCode = 'local _S={}\n';
  for (const [idx, enc] of Object.entries(tableEntries)) {
    tableCode += `_S[${idx}]="${enc}"\n`;
  }
  let newCode = code;
  unique.forEach((orig, i) => {
    const idx = i + 1;
    const repl = `(_S[${idx}]:gsub(".",function(c)return string.char(string.byte(c)~${keyByte})end))`;
    newCode = newCode.split(orig).join(repl);
  });
  newCode = newCode.replace(/\blocal\s+([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, name) => {
    if (['_S', 'string', 'char', 'byte', 'gsub'].includes(name)) return match;
    return `local ${[...Array(name.length)].map(() => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random()*26)]).join('')}`;
  });
  return tableCode + '\n' + newCode + '\n-- Junk: ' + Math.random().toString(36).substring(2,10);
}

function heavyObfuscate(code) {
  const isRoblox = /\bgame\b/i.test(code);
  if (isRoblox) {
    const key = crypto.randomBytes(16);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    let encrypted = cipher.update(code, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const payload = iv.toString('base64') + ':' + encrypted;
    const checksum = crypto.createHash('sha256').update(payload).digest('hex').substring(0,8);
    const finalData = checksum + payload;
    const loader = `return(function(...)
local function B(S)
 local b,l,f=string.byte,string.sub,math.floor
 local ivEnc,data = S:match(":(.*)$"), S:match("^(.*):")
 if not ivEnc then return end
 local iv = {}
 for i=1,#ivEnc do iv[#iv+1]=b(ivEnc,i) end
 local key = {${[...key].join(',')}}
 local cipher = require("crypto")
 if not cipher then return end
 local decrypt = cipher.decrypt("aes-128-cbc", key, iv, data)
 if not decrypt then return end
 return loadstring(decrypt)
end
local S=[[${finalData}]]
if #S<9 then return end
local h=string.sub(S,1,8)
if h~="${checksum}" then return end
local d=debug
if d then
 d.setmetatable=nil
 d.getmetatable=nil
 d.getfenv=nil
 d.setfenv=nil
 d.getinfo=nil
 d.getlocal=nil
 d.setlocal=nil
 d.getupvalue=nil
 d.setupvalue=nil
 d.sethook=function()end
 d.gethook=function()end
end
local raw=setmetatable({},{
 __index=function()end,
 __newindex=function()end,
 __metatable="locked"
})
local f=loadstring(B(S))
if not f then return end
local env={}
setmetatable(env,{__index=_G,__newindex=function()end})
local co=coroutine.create(f)
local ok,res=coroutine.resume(co,env)
if ok then return res end
return nil
end)()`;
    return loader;
  } else {
    const tmpFile = path.join(__dirname, 'uploads', `temp_${Date.now()}.lua`);
    const outFile = tmpFile + '.out';
    fs.writeFileSync(tmpFile, code);
    try {
      let args = [];
      try {
        execFileSync('luajit', ['-b', '-s', tmpFile, outFile], { timeout: 5000 });
      } catch {
        execFileSync('luac5.1', ['-s', '-o', outFile, tmpFile], { timeout: 5000 });
      }
      const bytecode = fs.readFileSync(outFile);
      const buf = Buffer.from(bytecode);
      const paddingLength = (4 - (buf.length % 4)) % 4;
      const padded = Buffer.concat([buf, Buffer.alloc(paddingLength)]);
      const encoded = packer.encode(padded);
      const checksum = crypto.createHash('sha256').update(encoded).digest('hex').substring(0,8);
      const finalData = checksum + encoded;
      const loader = `return(function(...)
local function B(S)
 local b,l,uc,f=string.byte,string.sub,bit32.bxor,math.floor
 S=l(S,9)
 S=l(S,'z','!!!!!'):gsub('[%s\r\n]','')
 local R={}
 local j=1
 while j<=#S do
  local L=#S-j+1
  local Y=(L>=5)and 5 or L
  local RS=0
  if Y==5 then
   local Y,U,lc,pS,Lj=b(S,j,j+4)
   RS=(Y-33)*0x31C84B1+(U-33)*0x95EED+(lc-33)*0x1C39+(pS-33)*0x55+(Lj-33)
  else
   for k=0,Y-1 do
    RS=RS*0x55+(b(S,j+k)-33)
   end
   for k=1,5-Y do
    RS=RS*0x55+0x54
   end
  end
  local yr=f(RS/0x1000000)%0x100
  local nh=f(RS/0x10000)%0x100
  local lc=f(RS/0x100)%0x100
  local rb=RS%0x100
  if Y==5 then
   R[#R+1]=string.char(yr,nh,lc,rb)
  else
   if Y>=2 then R[#R+1]=string.char(yr) end
   if Y>=3 then R[#R+1]=string.char(nh) end
   if Y>=4 then R[#R+1]=string.char(lc) end
  end
  j=j+Y
 end
 return table.concat(R)
end
local S=[[${finalData}]]
if #S<9 then return end
local h=string.sub(S,1,8)
if h~="${checksum}" then return end
local d=debug
if d then
 d.setmetatable=nil
 d.getmetatable=nil
 d.getfenv=nil
 d.setfenv=nil
 d.getinfo=nil
 d.getlocal=nil
 d.setlocal=nil
 d.getupvalue=nil
 d.setupvalue=nil
 d.sethook=function()end
 d.gethook=function()end
end
local raw=setmetatable({},{
 __index=function()end,
 __newindex=function()end,
 __metatable="locked"
})
local f=loadstring(B(S))
if not f then return end
local env={}
setmetatable(env,{__index=_G,__newindex=function()end})
local co=coroutine.create(f)
local ok,res=coroutine.resume(co,env)
if ok then return res end
return nil
end)()`;
      return loader;
    } catch (err) {
      throw new Error('Compilation failed: ' + err.message);
    } finally {
      try { fs.unlinkSync(tmpFile); fs.unlinkSync(outFile); } catch(e) {}
    }
  }
}

app.post('/obfuscate', upload.single('file'), (req, res) => {
  try {
    let code = '';
    if (req.file) {
      code = fs.readFileSync(req.file.path, 'utf8');
      fs.unlinkSync(req.file.path);
    } else if (req.body.code) {
      code = req.body.code;
    } else {
      return res.status(400).json({error: 'No code'});
    }
    const mode = req.body.mode || 'light';
    let result;
    if (mode === 'heavy') {
      result = heavyObfuscate(code);
    } else {
      result = lightObfuscate(code);
    }
    res.json({ obfuscated: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Running on ' + PORT));
