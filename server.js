const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));
app.use(express.json());

// Danh sách từ khóa global Roblox + executor thường dùng
const GLOBAL_KEYWORDS = [
  'game', 'workspace', 'Players', 'ReplicatedStorage', 'Lighting',
  'task', 'spawn', 'delay', 'wait', 'tick', 'time', 'elapsedTime',
  'Instance', 'TweenService', 'Color3', 'Vector2', 'Vector3', 'UDim2', 'UDim',
  'CFrame', 'Enum', 'math', 'os', 'table', 'string', 'coroutine',
  'pcall', 'xpcall', 'require', 'loadstring', 'getgenv', 'getfenv', 'setfenv',
  'rawget', 'rawset', 'rawequal', 'rawlen',
  'Networking', 'CollectionService', 'PlayerStateClient',
  'RaycastParams', 'Random', 'ColorSequence', 'ColorSequenceKeypoint',
  'Faces', 'Axes', 'BrickColor', 'CatalogSearchParams', 'DebuggerManager',
  'NumberRange', 'NumberSequence', 'NumberSequenceKeypoint',
  'OverlapParams', 'Path', 'PathWaypoint', 'PhysicalProperties',
  'Random', 'Ray', 'RaycastParams', 'Rect', 'Region3',
  'Region3int16', 'SharedTable', 'TweenInfo', 'UDim', 'UDim2',
  'Vector2', 'Vector3', 'Vector3int16', 'DateTime', 'DockWidgetPluginGui',
  'Faces', 'Axes', 'BrickColor', 'CatalogSearchParams',
  // Executor-specific
  'getexecutorname', 'syn', 'krnl', 'jjs', 'script_context',
  'getcustomasset', 'writefile', 'readfile', 'appendfile', 'listfiles',
  'isfile', 'isfolder', 'makefolder', 'delfile', 'delfolder',
  'loadfile', 'dofile', 'printidentity', 'setidentity', 'getidentity',
  'checkcaller', 'setreadonly', 'getrawmetatable', 'hookfunction',
  'hookfunc', 'newcclosure', 'loadstring', 'getgc', 'getreg',
  'getupvalues', 'getupvalue', 'setupvalue', 'getconstants',
  'getconstant', 'setconstant', 'getprotos', 'getproto',
  'getnamecallmethod', 'setnamecallmethod', 'getscripthash',
  'getthreadidentity', 'setthreadidentity', 'getrenv',
  'getrawget', 'getrawset', 'getrawlen'
];

function lightObfuscate(code) {
  const keyByte = crypto.randomBytes(1).readUInt8(0);
  
  // Tách tất cả string literal
  const strings = [];
  const stringRegex = /(["'])(?:(?=(\\?))\2.)*?\1/g;
  let match;
  while ((match = stringRegex.exec(code)) !== null) {
    strings.push(match[0]);
  }
  const unique = [...new Set(strings)];
  const allMappings = {};

  // Chia string dài thành chunks
  let idx = 1;
  const stringMap = new Map();
  unique.forEach(s => {
    const content = s.slice(1, -1);
    if (content.length <= 4) {
      const enc = [...content].map(c => String.fromCharCode(c.charCodeAt(0) ^ keyByte)).join('');
      allMappings[idx] = enc;
      stringMap.set(s, { idx, key: keyByte });
      idx++;
    } else {
      const chunks = [];
      for (let i = 0; i < content.length; i += 4) {
        chunks.push(content.substring(i, i + 4));
      }
      stringMap.set(s, { idxes: [] });
      chunks.forEach(chunk => {
        const enc = [...chunk].map(c => String.fromCharCode(c.charCodeAt(0) ^ keyByte)).join('');
        allMappings[idx] = enc;
        stringMap.get(s).idxes.push(idx);
        idx++;
      });
    }
  });

  // Thêm global keywords (chỉ những từ thực sự có mặt)
  const usedGlobals = [];
  for (const kw of GLOBAL_KEYWORDS) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp('\\b' + escaped + '\\b', 'g').test(code)) {
      usedGlobals.push(kw);
    }
  }
  const globalMap = {};
  usedGlobals.forEach(kw => {
    const enc = [...kw].map(c => String.fromCharCode(c.charCodeAt(0) ^ keyByte)).join('');
    allMappings[idx] = enc;
    globalMap[kw] = idx;
    idx++;
  });

  // Tạo bảng _S
  let tableCode = 'local _S={}\n';
  for (const [i, enc] of Object.entries(allMappings)) {
    tableCode += `_S[${i}]="${enc}"\n`;
  }

  // Thay thế string literals
  let newCode = code;
  for (const [orig, info] of stringMap) {
    if (info.idx) {
      const repl = `(_S[${info.idx}]:gsub(".",function(c)return string.char(string.byte(c)~${keyByte})end))`;
      newCode = newCode.split(orig).join(repl);
    } else {
      const repl = '(' + info.idxes.map(i => `(_S[${i}]:gsub(".",function(c)return string.char(string.byte(c)~${keyByte})end))`).join('..') + ')';
      newCode = newCode.split(orig).join(repl);
    }
  }

  // Thay thế global keywords
  for (const [kw, idx] of Object.entries(globalMap).sort((a,b) => b[0].length - a[0].length)) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('\\b' + escaped + '\\b', 'g');
    newCode = newCode.replace(regex, `_G[_S[${idx}]:gsub(".",function(c)return string.char(string.byte(c)~${keyByte})end())]`);
  }

  // Đổi tên biến local
  const localDeclRegex = /local\s+(?:function\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
  const declaredLocals = new Set();
  let declMatch;
  while ((declMatch = localDeclRegex.exec(newCode)) !== null) {
    declaredLocals.add(declMatch[1]);
  }
  const renameMap = {};
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  for (const name of declaredLocals) {
    let newName;
    do {
      newName = Array.from({length: 10 + Math.floor(Math.random() * 6)}, () => alphabet[Math.floor(Math.random() * 26)]).join('');
    } while (Object.values(renameMap).includes(newName) || GLOBAL_KEYWORDS.includes(newName));
    renameMap[name] = newName;
  }
  for (const [oldName, newName] of Object.entries(renameMap)) {
    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    newCode = newCode.replace(new RegExp('\\b' + escaped + '\\b', 'g'), newName);
  }

  // Anti‑debug
  const antiDebug = `
local __dbg = debug
if __dbg then
 __dbg.setmetatable = nil
 __dbg.getmetatable = nil
 __dbg.getfenv = nil
 __dbg.setfenv = nil
 __dbg.getinfo = nil
 __dbg.getlocal = nil
 __dbg.setlocal = nil
 __dbg.getupvalue = nil
 __dbg.setupvalue = nil
 __dbg.sethook = function() end
 __dbg.gethook = function() end
end
local __hook = hookfunction or hookfunc
if __hook then
 __hook(print, function() end)
 __hook(warn, function() end)
 __hook(error, function() end)
end
`;

  return antiDebug + tableCode + '\n' + newCode + '\n-- Junk: ' + Math.random().toString(36).substring(2,10);
}

function heavyObfuscate(code) {
  // Chỉ xử lý Roblox scripts (có game)
  if (/\bgame\b/i.test(code)) {
    const seed = crypto.randomBytes(4).readUInt32LE(0);
    const key = crypto.randomBytes(16);
    const keyBytes = [...key];

    // Tầng 1: XOR với key
    const stage1 = Buffer.alloc(code.length);
    for (let i = 0; i < code.length; i++) {
      stage1[i] = code.charCodeAt(i) ^ keyBytes[i % keyBytes.length];
    }

    // Tầng 2: LCG stream
    const lcg = (s) => (s * 1103515245 + 12345) & 0x7fffffff;
    let s = seed;
    const stage2 = Buffer.alloc(stage1.length);
    for (let i = 0; i < stage1.length; i++) {
      s = lcg(s);
      stage2[i] = stage1[i] ^ ((s >> 16) & 0xFF);
    }

    // Tầng 3: shuffle
    const perm = [...Array(stage2.length).keys()].sort(() => Math.random() - 0.5);
    const stage3 = Buffer.alloc(stage2.length);
    for (let i = 0; i < stage2.length; i++) {
      stage3[perm[i]] = stage2[i];
    }

    // Tầng 4: XOR key lần nữa
    const stage4 = Buffer.alloc(stage3.length);
    for (let i = 0; i < stage3.length; i++) {
      stage4[i] = stage3[i] ^ keyBytes[i % keyBytes.length];
    }

    const encoded = stage4.toString('base64');
    const checksum = crypto.createHash('sha256').update(encoded).digest('hex').substring(0,8);
    // Dùng dấu phân cách ":" để tách checksum và data
    const finalData = checksum + ':' + encoded;

    const permLua = `{${perm.join(',')}}`;

    // Loader sửa lỗi: dùng bit.bxor nếu có, fallback bit32.bxor; xóa dòng string.sub sai
    const loader = `
return(function(...)
local __ee = string.byte; local __cc = string.char; local __floor = math.floor; local __sub = string.sub
-- Chọn bxor
local __bxor
if type(bit) == 'table' and bit.bxor then
  __bxor = bit.bxor
else
  __bxor = bit32.bxor
end
-- Base64 decode
local function __b64(b)
 local __t = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
 local __o = {}; local __v = 0; local __e = 0
 for i=1,#b do
  local __c = __sub(b,i,i)
  if __c == '=' then break end
  local __n = string.find(__t, __c, 1, true)
  if not __n then return nil end
  __v = __v * 64 + (__n-1)
  __e = __e + 1
  if __e == 4 then
   __o[#__o+1] = __cc(__floor(__v/65536)%256, __floor(__v/256)%256, __v%256)
   __v = 0; __e = 0
  end
 end
 if __e > 0 then
  for _=1,4-__e do __v = __v * 64 + 64 end
  __o[#__o+1] = __cc(__floor(__v/65536)%256)
  if __e >= 2 then __o[#__o+1] = __cc(__floor(__v/256)%256) end
 end
 return table.concat(__o)
end
-- Main
local S = [[${finalData}]]
if #S<10 then return end
local __sep = S:find(':',1,true)
if not __sep then return end
local __check = __sub(S,1,__sep-1)
if __check ~= "${checksum}" then return end
local __data = __sub(S,__sep+1)
local __raw = __b64(__data)
if not __raw then return end

local __key = {${keyBytes.join(',')}}
local __seed = ${seed}
local __lgc = function(s) return (s * 1103515245 + 12345) % 2147483647 end

local __perm = ${permLua}
local __inv = {}; for i=1,#__perm do __inv[__perm[i]+1] = i-1 end

local __a = {}
for i=1,#__raw do __a[i] = __ee(__raw,i) end

-- Undo stage4
for i=1,#__a do __a[i] = __a[i] ~ __key[(i-1)%16+1] end

-- Undo shuffle
local __b = {}
for i=1,#__a do __b[__inv[i-1]+1] = __a[i] end

-- Undo LCG
local __s = __seed
for i=1,#__b do
 __s = __lgc(__s)
 __b[i] = __b[i] ~ ((__s // 65536) % 256)
end

-- Undo stage1
for i=1,#__b do __b[i] = __b[i] ~ __key[(i-1)%16+1] end

local __dec = __cc(table.unpack(__b))

-- Anti-debug & junk
if debug then
 debug.setmetatable = nil; debug.getmetatable = nil; debug.getfenv = nil
 debug.setfenv = nil; debug.getinfo = nil; debug.getlocal = nil
 debug.setlocal = nil; debug.getupvalue = nil; debug.setupvalue = nil
 debug.sethook = function() end; debug.gethook = function() end
end
local __hook = hookfunction or hookfunc
if __hook then __hook(print, function() end) __hook(warn, function() end) __hook(error, function() end) end
-- Opaque predicates & junk code
local __j1 = 0; for i=1,100 do __j1 = __j1 + i end; if __j1 ~= 5050 then return end
local __j2 = false; repeat local x = math.random() until __j2; -- never runs
local __j3 = {[1]=true,[2]=false}
if __j3[1] and __j3[2] then return end

local __f, __err = loadstring(__dec)
if not __f then return nil end
local __env = {}
setmetatable(__env, {__index = _G, __newindex = function() end})
local __co = coroutine.create(__f)
local __ok, __res = coroutine.resume(__co, __env)
if __ok then return __res end
return nil
end)()`;
    return loader;
  } else {
    // Nếu không có game, dùng light mode
    return lightObfuscate(code);
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
