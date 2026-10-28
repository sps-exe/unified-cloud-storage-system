-- Baseline schema for UCSS (matches schema.prisma plus the CHECK constraints the app relies on).
-- Existing installs created with `prisma db push`: run `prisma migrate resolve --applied 0_init` once.

CREATE TYPE "AccountStatus" AS ENUM (
    'ACTIVE',
    'SUSPENDED',
    'TOKEN_EXPIRED',
    'QUOTA_EXCEEDED',
    'DISCONNECTED'
);

CREATE TYPE "UploadStatus" AS ENUM (
    'PENDING',
    'UPLOADING',
    'COMPLETED',
    'FAILED',
    'ORPHANED',
    'CANCELLED'
);

CREATE TABLE audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    action character varying(100) NOT NULL,
    resource_type character varying(50),
    resource_id uuid,
    metadata json,
    ip_address inet,
    user_agent character varying(500),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE drive_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    google_email character varying(255) NOT NULL,
    google_account_id character varying(100) NOT NULL,
    encrypted_refresh_token text NOT NULL,
    status "AccountStatus" DEFAULT 'ACTIVE'::"AccountStatus" NOT NULL,
    quota_limit_bytes bigint DEFAULT 0 NOT NULL,
    quota_used_bytes bigint DEFAULT 0 NOT NULL,
    reserved_bytes bigint DEFAULT 0 NOT NULL,
    quota_last_synced_at timestamp with time zone,
    connected_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    last_verified_at timestamp with time zone,
    disconnected_at timestamp with time zone,
    CONSTRAINT chk_drive_accounts_quota_limit CHECK ((quota_limit_bytes >= 0)),
    CONSTRAINT chk_drive_accounts_quota_used CHECK ((quota_used_bytes >= 0)),
    CONSTRAINT chk_drive_accounts_reserved_bytes CHECK ((reserved_bytes >= 0))
);

CREATE TABLE files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    drive_account_id uuid NOT NULL,
    drive_file_id character varying(255),
    original_filename character varying(1000) NOT NULL,
    display_filename character varying(1000) NOT NULL,
    mime_type character varying(255) DEFAULT 'application/octet-stream'::character varying NOT NULL,
    size_bytes bigint NOT NULL,
    upload_status "UploadStatus" DEFAULT 'PENDING'::"UploadStatus" NOT NULL,
    checksum_sha256 character(64),
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    remote_modified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT chk_files_size_bytes CHECK ((size_bytes >= 0))
);

CREATE TABLE storage_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    drive_account_id uuid NOT NULL,
    quota_limit_bytes bigint NOT NULL,
    quota_used_bytes bigint NOT NULL,
    usage_in_drive bigint NOT NULL,
    usage_in_trash bigint NOT NULL,
    managed_file_count integer DEFAULT 0 NOT NULL,
    captured_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_snapshots_quota_limit CHECK ((quota_limit_bytes >= 0))
);

CREATE TABLE upload_operations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    file_id uuid NOT NULL,
    drive_account_id uuid NOT NULL,
    status "UploadStatus" DEFAULT 'PENDING'::"UploadStatus" NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    max_retries integer DEFAULT 3 NOT NULL,
    error_message text,
    error_code character varying(100),
    google_upload_session_uri text,
    bytes_uploaded_to_date bigint DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp with time zone,
    duration_ms integer,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT chk_upload_ops_bytes_uploaded CHECK ((bytes_uploaded_to_date >= 0))
);

CREATE TABLE users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    display_name character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY drive_accounts
    ADD CONSTRAINT drive_accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY storage_snapshots
    ADD CONSTRAINT storage_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY upload_operations
    ADD CONSTRAINT upload_operations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX drive_accounts_user_id_google_account_id_key ON drive_accounts USING btree (user_id, google_account_id);

CREATE UNIQUE INDEX files_drive_account_id_drive_file_id_key ON files USING btree (drive_account_id, drive_file_id);

CREATE INDEX idx_audit_ip ON audit_logs USING btree (ip_address, created_at DESC);

CREATE INDEX idx_audit_resource ON audit_logs USING btree (resource_type, resource_id, created_at DESC);

CREATE INDEX idx_audit_user_time ON audit_logs USING btree (user_id, created_at DESC);

CREATE INDEX idx_drive_accounts_user_status ON drive_accounts USING btree (user_id, status);

CREATE INDEX idx_files_drive_file_id ON files USING btree (drive_file_id);

CREATE INDEX idx_files_upload_status ON files USING btree (upload_status, updated_at);

CREATE INDEX idx_files_user_active ON files USING btree (user_id, is_deleted, created_at DESC);

CREATE INDEX idx_files_user_mime ON files USING btree (user_id, mime_type, is_deleted);

CREATE INDEX idx_snapshots_account_time ON storage_snapshots USING btree (drive_account_id, captured_at DESC);

CREATE INDEX idx_upload_ops_account_status ON upload_operations USING btree (drive_account_id, status);

CREATE INDEX idx_upload_ops_file_status ON upload_operations USING btree (file_id, status);

CREATE INDEX idx_upload_ops_status_started ON upload_operations USING btree (status, started_at);

CREATE UNIQUE INDEX users_email_key ON users USING btree (email);

ALTER TABLE ONLY drive_accounts
    ADD CONSTRAINT drive_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY files
    ADD CONSTRAINT files_drive_account_id_fkey FOREIGN KEY (drive_account_id) REFERENCES drive_accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY files
    ADD CONSTRAINT files_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY storage_snapshots
    ADD CONSTRAINT storage_snapshots_drive_account_id_fkey FOREIGN KEY (drive_account_id) REFERENCES drive_accounts(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY upload_operations
    ADD CONSTRAINT upload_operations_drive_account_id_fkey FOREIGN KEY (drive_account_id) REFERENCES drive_accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY upload_operations
    ADD CONSTRAINT upload_operations_file_id_fkey FOREIGN KEY (file_id) REFERENCES files(id) ON UPDATE CASCADE ON DELETE CASCADE;
