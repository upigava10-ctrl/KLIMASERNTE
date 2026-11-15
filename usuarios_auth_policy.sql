-- Apply this separately to an existing public.usuarios table.
-- Profile-only mode permits anonymous profile creation and email lookup.
-- This does not authenticate users or protect profile data.
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.usuarios TO anon, authenticated;

DROP POLICY IF EXISTS usuarios_select_own_profile ON public.usuarios;
DROP POLICY IF EXISTS usuarios_public_select ON public.usuarios;
DROP POLICY IF EXISTS usuarios_public_insert ON public.usuarios;

CREATE POLICY usuarios_public_select
ON public.usuarios
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY usuarios_public_insert
ON public.usuarios
FOR INSERT
TO anon, authenticated
WITH CHECK (true);
