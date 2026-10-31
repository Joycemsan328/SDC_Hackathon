-- READ ONLY. Owner review before EVENTFLOW_MVP_INSERT_VERIFIED=true.
-- No migrations, RPC execution, customer data, or permission changes.
select table_name, column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('requests', 'proposals')
order by table_name, ordinal_position;

select conname, pg_get_constraintdef(oid, true) as definition
from pg_constraint
where conrelid = 'public.proposals'::regclass and contype = 'c'
order by conname;

-- The owner's existing export already verifies the partial unique index on
-- (request_id, revision, plan_key). Keep it unchanged.
-- Check all omitted NOT NULL fields have defaults; id is supplied by the backend.
-- status must accept Pending Business Approval; revision must accept '1';
-- plan_content must accept JSON; optional booking fields can be NULL only if
-- allowed by their existing column/CHECK constraints. Do not insert test rows.
