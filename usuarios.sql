CREATE TABLE IF NOT EXISTS public.usuarios (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  producerSize TEXT DEFAULT 'SMALL',
  email TEXT NOT NULL UNIQUE,
  isFarmer BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  apellido_p TEXT NOT NULL,
  apellido_m TEXT NOT NULL,
  activate_u BOOLEAN DEFAULT TRUE,
  photourl TEXT
);

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS photourl TEXT;

UPDATE public.usuarios SET uuid = gen_random_uuid() WHERE uuid IS NULL;
UPDATE public.usuarios SET email = lower(email);

ALTER TABLE public.usuarios ALTER COLUMN uuid SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_uuid_key ON public.usuarios (uuid);
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_lower_key
  ON public.usuarios (lower(email));