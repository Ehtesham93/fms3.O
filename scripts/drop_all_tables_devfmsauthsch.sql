-- Drop all tables in the devfmsauthsch schema with CASCADE
-- This script will be modified by the shell script to replace 'devfmsauthsch' with the target schema

DO $$ 
DECLARE 
    r RECORD;
    schema_var text := 'devfmsauthsch';
BEGIN
    RAISE NOTICE 'Dropping all objects in schema: %', schema_var;
    
    -- Drop all tables in the schema with CASCADE
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = schema_var) LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(schema_var) || '.' || quote_ident(r.tablename) || ' CASCADE';
        RAISE NOTICE 'Dropped table: %.%', schema_var, r.tablename;
    END LOOP;
    
    -- Drop all views in the schema with CASCADE
    FOR r IN (SELECT viewname FROM pg_views WHERE schemaname = schema_var) LOOP
        EXECUTE 'DROP VIEW IF EXISTS ' || quote_ident(schema_var) || '.' || quote_ident(r.viewname) || ' CASCADE';
        RAISE NOTICE 'Dropped view: %.%', schema_var, r.viewname;
    END LOOP;
    
    -- Drop all materialized views in the schema with CASCADE
    FOR r IN (SELECT matviewname FROM pg_matviews WHERE schemaname = schema_var) LOOP
        EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS ' || quote_ident(schema_var) || '.' || quote_ident(r.matviewname) || ' CASCADE';
        RAISE NOTICE 'Dropped materialized view: %.%', schema_var, r.matviewname;
    END LOOP;
    
    -- Drop all functions in the schema with CASCADE
    FOR r IN (SELECT proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = schema_var) LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || quote_ident(schema_var) || '.' || quote_ident(r.proname) || ' CASCADE';
        RAISE NOTICE 'Dropped function: %.%', schema_var, r.proname;
    END LOOP;
    
    -- Drop all triggers in the schema with CASCADE
    FOR r IN (SELECT tgname FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = schema_var) LOOP
        EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(r.tgname) || ' ON ' || quote_ident(schema_var) || '.* CASCADE';
        RAISE NOTICE 'Dropped trigger: %', r.tgname;
    END LOOP;
    
    -- Drop all sequences in the schema with CASCADE
    FOR r IN (SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = schema_var) LOOP
        EXECUTE 'DROP SEQUENCE IF EXISTS ' || quote_ident(schema_var) || '.' || quote_ident(r.sequence_name) || ' CASCADE';
        RAISE NOTICE 'Dropped sequence: %.%', schema_var, r.sequence_name;
    END LOOP;
    
    -- Drop all indexes in the schema with CASCADE
    FOR r IN (SELECT indexname FROM pg_indexes WHERE schemaname = schema_var) LOOP
        EXECUTE 'DROP INDEX IF EXISTS ' || quote_ident(schema_var) || '.' || quote_ident(r.indexname) || ' CASCADE';
        RAISE NOTICE 'Dropped index: %.%', schema_var, r.indexname;
    END LOOP;
    
    -- Drop all types in the schema with CASCADE
    FOR r IN (SELECT typname FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = schema_var) LOOP
        EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(schema_var) || '.' || quote_ident(r.typname) || ' CASCADE';
        RAISE NOTICE 'Dropped type: %.%', schema_var, r.typname;
    END LOOP;
    
    RAISE NOTICE 'All objects in schema % have been dropped with CASCADE', schema_var;
END $$; 