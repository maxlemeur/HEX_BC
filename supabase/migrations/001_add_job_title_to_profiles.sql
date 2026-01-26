-- Migration: Add job_title and work_email fields to profiles table
-- job_title: User's professional title (e.g., "Chargé d'affaires")
-- work_email: Professional email displayed on documents

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS job_title text;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS work_email text;

-- Update the handle_new_user function to include new fields
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, job_title, work_email, role)
  VALUES (
    new.id,
    COALESCE(NULLIF(TRIM(new.raw_user_meta_data->>'full_name'), ''), new.email, 'Utilisateur'),
    NULLIF(TRIM(new.raw_user_meta_data->>'phone'), ''),
    NULLIF(TRIM(new.raw_user_meta_data->>'job_title'), ''),
    new.email,
    'buyer'
  );
  RETURN new;
END;
$$;
