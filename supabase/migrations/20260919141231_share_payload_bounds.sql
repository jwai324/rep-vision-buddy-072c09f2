-- A share's payload had no server-side bound. The client refuses anything
-- over 1,000,000 characters, but the table accepted any size from a request
-- that skipped the client, and get_shared_item() then streamed the whole
-- thing to anyone holding the link, on this project's egress. A real payload
-- runs 50–100 KB (a program with every template embedded), so 1 MiB is ten
-- times the largest legitimate share. The title is bounded the same way; the
-- client clamps it before the insert so a long template name never trips the
-- constraint.
ALTER TABLE public.shares
  ADD CONSTRAINT shares_payload_size_check CHECK (pg_column_size(payload) <= 1048576),
  ADD CONSTRAINT shares_title_length_check CHECK (char_length(title) <= 200);
