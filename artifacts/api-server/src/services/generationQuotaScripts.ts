// One Redis hash is the durable ledger. Do not add TTLs, refunds, or auto-reset.
export const DEMO_QUOTA_KEY = "eventflow:submission-demo:quota";
export const DEMO_JOB_LIMIT = 5;
export const EXTENDED_DEMO_JOB_LIMIT = 20;
export const MAX_DEMO_JOB_LIMIT = 35;
export const CURRENT_DEMO_JOB_LIMIT = 50;

export const INITIALIZE_QUOTA = `
if redis.call('EXISTS', KEYS[1]) == 1 then return {'EXISTS'} end
redis.call('HSET', KEYS[1], 'schema', '1', 'limit', '5', 'used', '0')
return {'INITIALIZED'}
`;

// Explicit operator action only. Never reset used/history or allow repeat top-ups.
export const EXTEND_QUOTA_TO_35_ONCE = `
if redis.call('EXISTS', KEYS[1]) == 0 then return {'UNINITIALIZED'} end
local schema = redis.call('HGET', KEYS[1], 'schema')
local limit = redis.call('HGET', KEYS[1], 'limit')
local used = tonumber(redis.call('HGET', KEYS[1], 'used'))
local extension15 = redis.call('HGET', KEYS[1], 'extension_15_applied')
local extension15At = redis.call('HGET', KEYS[1], 'extension_15_applied_at')
local extension20To35 = redis.call('HGET', KEYS[1], 'extension_20_to_35_applied')
local extension20To35At = redis.call('HGET', KEYS[1], 'extension_20_to_35_applied_at')
if schema ~= '1' or not used or used < 0 or used > ${MAX_DEMO_JOB_LIMIT} or used ~= math.floor(used) or redis.call('TTL', KEYS[1]) ~= -1 then
  return {'CORRUPT'}
end
if redis.call('HGET', KEYS[1], 'extension_10_applied') then return {'CONFLICT'} end

local alreadyApplied = limit == '${MAX_DEMO_JOB_LIMIT}' and extension15 == '1' and extension15At and extension15At ~= ''
    and extension20To35 == '1' and extension20To35At and extension20To35At ~= '' and used >= 5
local eligible = limit == '${EXTENDED_DEMO_JOB_LIMIT}' and extension15 == '1' and extension15At and extension15At ~= ''
    and not extension20To35 and not extension20To35At and used >= 5 and used <= ${EXTENDED_DEMO_JOB_LIMIT}
if not alreadyApplied and not eligible then return {'CONFLICT'} end

-- Validate the complete ledger shape and reservation count before changing only
-- the cap. Every consumed slot must still have exactly one request/revision entry.
local function validUuid(value)
  if type(value) ~= 'string' or #value ~= 36
      or string.sub(value, 9, 9) ~= '-' or string.sub(value, 14, 14) ~= '-'
      or string.sub(value, 19, 19) ~= '-' or string.sub(value, 24, 24) ~= '-' then
    return false
  end
  local compact = string.gsub(value, '%-', '')
  return #compact == 32 and string.match(compact, '^%x+$') ~= nil
end
local history = 0
for _, field in ipairs(redis.call('HKEYS', KEYS[1])) do
  if field == 'schema' or field == 'limit' or field == 'used'
      or field == 'extension_15_applied' or field == 'extension_15_applied_at'
      or field == 'extension_20_to_35_applied' or field == 'extension_20_to_35_applied_at' then
    -- Known ledger metadata.
  else
    local id = nil
    if string.sub(field, 1, 8) == 'request:' then id = string.sub(field, 9)
    elseif string.sub(field, 1, 9) == 'revision:' then id = string.sub(field, 10)
    else return {'CORRUPT'} end
    if not validUuid(id) then return {'CORRUPT'} end
    local decoded, entry = pcall(cjson.decode, redis.call('HGET', KEYS[1], field) or '')
    if not decoded or type(entry) ~= 'table' or not validUuid(entry.customerId) or not validUuid(entry.token)
        or type(entry.fingerprint) ~= 'string' or #entry.fingerprint ~= 64
        or not string.match(entry.fingerprint, '^[0-9a-f]+$')
        or type(entry.createdAt) ~= 'string' or #entry.createdAt == 0
        or (entry.state ~= 'reserved' and entry.state ~= 'ready' and entry.state ~= 'saved' and entry.state ~= 'failed')
        or ((entry.state == 'ready' or entry.state == 'saved') and type(entry.proposal) ~= 'table') then
      return {'CORRUPT'}
    end
    local entryKeys = 0
    for key, _ in pairs(entry) do
      if key ~= 'customerId' and key ~= 'token' and key ~= 'fingerprint'
          and key ~= 'createdAt' and key ~= 'state' and key ~= 'proposal' then
        return {'CORRUPT'}
      end
      entryKeys = entryKeys + 1
    end
    if entryKeys < 5 or entryKeys > 6 then return {'CORRUPT'} end
    history = history + 1
  end
end

if alreadyApplied then
  if redis.call('HLEN', KEYS[1]) == used + 7 and history == used then return {'ALREADY_APPLIED'} end
  return {'CORRUPT'}
end
if redis.call('HLEN', KEYS[1]) ~= used + 5 or history ~= used then return {'CORRUPT'} end
redis.call('HSET', KEYS[1], 'limit', '${MAX_DEMO_JOB_LIMIT}', 'extension_20_to_35_applied', '1', 'extension_20_to_35_applied_at', ARGV[1])
return {'EXTENDED'}
`;

// Explicit operator action only. Preserves every consumed slot and reservation.
export const EXTEND_QUOTA_TO_50_ONCE = `
if redis.call('EXISTS', KEYS[1]) == 0 then return {'UNINITIALIZED'} end
local schema = redis.call('HGET', KEYS[1], 'schema')
local limit = redis.call('HGET', KEYS[1], 'limit')
local usedRaw = redis.call('HGET', KEYS[1], 'used')
local used = tonumber(usedRaw)
local extension15 = redis.call('HGET', KEYS[1], 'extension_15_applied')
local extension15At = redis.call('HGET', KEYS[1], 'extension_15_applied_at')
local extension20To35 = redis.call('HGET', KEYS[1], 'extension_20_to_35_applied')
local extension20To35At = redis.call('HGET', KEYS[1], 'extension_20_to_35_applied_at')
local extension35To50 = redis.call('HGET', KEYS[1], 'extension_35_to_50_applied')
local extension35To50At = redis.call('HGET', KEYS[1], 'extension_35_to_50_applied_at')
if not ARGV[1] or ARGV[1] == '' then return {'CORRUPT'} end
if schema ~= '1' or not used or usedRaw ~= tostring(used) or used < 5
    or used > ${CURRENT_DEMO_JOB_LIMIT} or used ~= math.floor(used)
    or redis.call('TTL', KEYS[1]) ~= -1 then
  return {'CORRUPT'}
end
if redis.call('HGET', KEYS[1], 'extension_10_applied') then return {'CONFLICT'} end
if extension15 ~= '1' or not extension15At or extension15At == ''
    or extension20To35 ~= '1' or not extension20To35At or extension20To35At == '' then
  return {'CONFLICT'}
end

local alreadyApplied = limit == '${CURRENT_DEMO_JOB_LIMIT}'
    and extension35To50 == '1' and extension35To50At and extension35To50At ~= ''
local eligible = limit == '${MAX_DEMO_JOB_LIMIT}'
    and not extension35To50 and not extension35To50At and used <= ${MAX_DEMO_JOB_LIMIT}
if not alreadyApplied and not eligible then return {'CONFLICT'} end

local function validUuid(value)
  if type(value) ~= 'string' or #value ~= 36
      or string.sub(value, 9, 9) ~= '-' or string.sub(value, 14, 14) ~= '-'
      or string.sub(value, 19, 19) ~= '-' or string.sub(value, 24, 24) ~= '-' then
    return false
  end
  local compact = string.gsub(value, '%-', '')
  return #compact == 32 and string.match(compact, '^%x+$') ~= nil
end
local history = 0
for _, field in ipairs(redis.call('HKEYS', KEYS[1])) do
  if field == 'schema' or field == 'limit' or field == 'used'
      or field == 'extension_15_applied' or field == 'extension_15_applied_at'
      or field == 'extension_20_to_35_applied' or field == 'extension_20_to_35_applied_at'
      or field == 'extension_35_to_50_applied' or field == 'extension_35_to_50_applied_at' then
    -- Known ledger metadata.
  else
    local id = nil
    if string.sub(field, 1, 8) == 'request:' then id = string.sub(field, 9)
    elseif string.sub(field, 1, 9) == 'revision:' then id = string.sub(field, 10)
    else return {'CORRUPT'} end
    if not validUuid(id) then return {'CORRUPT'} end
    local decoded, entry = pcall(cjson.decode, redis.call('HGET', KEYS[1], field) or '')
    if not decoded or type(entry) ~= 'table' or not validUuid(entry.customerId) or not validUuid(entry.token)
        or type(entry.fingerprint) ~= 'string' or #entry.fingerprint ~= 64
        or not string.match(entry.fingerprint, '^[0-9a-f]+$')
        or type(entry.createdAt) ~= 'string' or #entry.createdAt == 0
        or (entry.state ~= 'reserved' and entry.state ~= 'ready' and entry.state ~= 'saved' and entry.state ~= 'failed')
        or ((entry.state == 'ready' or entry.state == 'saved') and type(entry.proposal) ~= 'table') then
      return {'CORRUPT'}
    end
    local entryKeys = 0
    for key, _ in pairs(entry) do
      if key ~= 'customerId' and key ~= 'token' and key ~= 'fingerprint'
          and key ~= 'createdAt' and key ~= 'state' and key ~= 'proposal' then
        return {'CORRUPT'}
      end
      entryKeys = entryKeys + 1
    end
    if entryKeys < 5 or entryKeys > 6 then return {'CORRUPT'} end
    history = history + 1
  end
end

if alreadyApplied then
  if redis.call('HLEN', KEYS[1]) == used + 9 and history == used then return {'ALREADY_APPLIED'} end
  return {'CORRUPT'}
end
if redis.call('HLEN', KEYS[1]) ~= used + 7 or history ~= used then return {'CORRUPT'} end
redis.call('HSET', KEYS[1], 'limit', '${CURRENT_DEMO_JOB_LIMIT}',
    'extension_35_to_50_applied', '1', 'extension_35_to_50_applied_at', ARGV[1])
return {'EXTENDED'}
`;

export const RESERVE_GENERATION = `
if redis.call('EXISTS', KEYS[1]) == 0 then return {'UNINITIALIZED'} end
local schema = redis.call('HGET', KEYS[1], 'schema')
local limit = redis.call('HGET', KEYS[1], 'limit')
local usedRaw = redis.call('HGET', KEYS[1], 'used')
local used = tonumber(usedRaw)
if schema ~= '1' or (limit ~= '5' and limit ~= '${EXTENDED_DEMO_JOB_LIMIT}' and limit ~= '${MAX_DEMO_JOB_LIMIT}' and limit ~= '${CURRENT_DEMO_JOB_LIMIT}') or not used or used < 0 or used ~= math.floor(used) then
  return {'CORRUPT'}
end
if limit == '${EXTENDED_DEMO_JOB_LIMIT}' and (redis.call('HGET', KEYS[1], 'extension_15_applied') ~= '1' or redis.call('HGET', KEYS[1], 'extension_10_applied') or used < 5) then
  return {'CORRUPT'}
end
if limit == '${MAX_DEMO_JOB_LIMIT}' and (redis.call('HGET', KEYS[1], 'extension_15_applied') ~= '1'
    or not redis.call('HGET', KEYS[1], 'extension_15_applied_at') or redis.call('HGET', KEYS[1], 'extension_15_applied_at') == ''
    or redis.call('HGET', KEYS[1], 'extension_20_to_35_applied') ~= '1'
    or not redis.call('HGET', KEYS[1], 'extension_20_to_35_applied_at') or redis.call('HGET', KEYS[1], 'extension_20_to_35_applied_at') == ''
    or redis.call('HGET', KEYS[1], 'extension_10_applied') or used < 5) then
  return {'CORRUPT'}
end
if limit == '${CURRENT_DEMO_JOB_LIMIT}' then
  local extension15At = redis.call('HGET', KEYS[1], 'extension_15_applied_at')
  local extension20To35At = redis.call('HGET', KEYS[1], 'extension_20_to_35_applied_at')
  local extension35To50 = redis.call('HGET', KEYS[1], 'extension_35_to_50_applied')
  local extension35To50At = redis.call('HGET', KEYS[1], 'extension_35_to_50_applied_at')
  if redis.call('HGET', KEYS[1], 'extension_15_applied') ~= '1'
      or not extension15At or extension15At == ''
      or redis.call('HGET', KEYS[1], 'extension_20_to_35_applied') ~= '1'
      or not extension20To35At or extension20To35At == ''
      or extension35To50 ~= '1' or not extension35To50At or extension35To50At == ''
      or redis.call('HGET', KEYS[1], 'extension_10_applied')
      or used < 5 or used > ${CURRENT_DEMO_JOB_LIMIT}
      or usedRaw ~= tostring(used)
      or redis.call('TTL', KEYS[1]) ~= -1
      or redis.call('HLEN', KEYS[1]) ~= used + 9 then
    return {'CORRUPT'}
  end
  local history = 0
  for _, field in ipairs(redis.call('HKEYS', KEYS[1])) do
    if field == 'schema' or field == 'limit' or field == 'used'
        or field == 'extension_15_applied' or field == 'extension_15_applied_at'
        or field == 'extension_20_to_35_applied' or field == 'extension_20_to_35_applied_at'
        or field == 'extension_35_to_50_applied' or field == 'extension_35_to_50_applied_at' then
      -- Known ledger metadata.
    else
      local id = nil
      if string.sub(field, 1, 8) == 'request:' then id = string.sub(field, 9)
      elseif string.sub(field, 1, 9) == 'revision:' then id = string.sub(field, 10)
      else return {'CORRUPT'} end
      if #id ~= 36 or string.sub(id, 9, 9) ~= '-' or string.sub(id, 14, 14) ~= '-'
          or string.sub(id, 19, 19) ~= '-' or string.sub(id, 24, 24) ~= '-' then return {'CORRUPT'} end
      local compact = string.gsub(id, '%-', '')
      if #compact ~= 32 or not string.match(compact, '^%x+$') then return {'CORRUPT'} end
      local decoded, entry = pcall(cjson.decode, redis.call('HGET', KEYS[1], field) or '')
      if not decoded or type(entry) ~= 'table' then return {'CORRUPT'} end
      local function validUuid(value)
        if type(value) ~= 'string' or #value ~= 36
            or string.sub(value, 9, 9) ~= '-' or string.sub(value, 14, 14) ~= '-'
            or string.sub(value, 19, 19) ~= '-' or string.sub(value, 24, 24) ~= '-' then return false end
        local compactValue = string.gsub(value, '%-', '')
        return #compactValue == 32 and string.match(compactValue, '^%x+$') ~= nil
      end
      if not validUuid(entry.customerId) or not validUuid(entry.token)
          or type(entry.fingerprint) ~= 'string' or #entry.fingerprint ~= 64
          or not string.match(entry.fingerprint, '^[0-9a-f]+$')
          or type(entry.createdAt) ~= 'string' or #entry.createdAt == 0
          or (entry.state ~= 'reserved' and entry.state ~= 'ready' and entry.state ~= 'saved' and entry.state ~= 'failed')
          or ((entry.state == 'ready' or entry.state == 'saved') and type(entry.proposal) ~= 'table') then
        return {'CORRUPT'}
      end
      local entryKeys = 0
      for key, _ in pairs(entry) do
        if key ~= 'customerId' and key ~= 'token' and key ~= 'fingerprint'
            and key ~= 'createdAt' and key ~= 'state' and key ~= 'proposal' then return {'CORRUPT'} end
        entryKeys = entryKeys + 1
      end
      if entryKeys < 5 or entryKeys > 6 then return {'CORRUPT'} end
      history = history + 1
    end
  end
  if history ~= used then return {'CORRUPT'} end
end
local cap = tonumber(limit)
if used > cap then
  return {'CORRUPT'}
end
local old = redis.call('HGET', KEYS[1], ARGV[1])
if old then return {'EXISTING', old} end
if used >= cap then return {'EXHAUSTED'} end
redis.call('HSET', KEYS[1], 'used', tostring(used + 1), ARGV[1], ARGV[2])
return {'RESERVED', ARGV[2]}
`;

export const TRANSITION_GENERATION = `
if redis.call('EXISTS', KEYS[1]) == 0 then return {'UNINITIALIZED'} end
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return {'CONFLICT'} end
local ok, old = pcall(cjson.decode, raw)
local valid, next = pcall(cjson.decode, ARGV[2])
if not ok or not valid then return {'CORRUPT'} end
if old.token ~= next.token or old.customerId ~= next.customerId or old.fingerprint ~= next.fingerprint then
  return {'CONFLICT'}
end
if old.state == 'saved' and next.state == 'saved' then return {'OK'} end
if not ((old.state == 'reserved' and (next.state == 'ready' or next.state == 'failed')) or
        (old.state == 'ready' and (next.state == 'saved' or next.state == 'failed'))) then return {'CONFLICT'} end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
return {'OK'}
`;
