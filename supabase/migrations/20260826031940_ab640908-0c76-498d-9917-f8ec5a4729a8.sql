-- 1. Tighten bug-attachments storage policies
DROP POLICY IF EXISTS "Authenticated can view bug attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload bug attachments" ON storage.objects;

CREATE POLICY "Users can upload bug attachments to own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'bug-attachments'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

CREATE POLICY "Bug attachment files viewable by related users"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'bug-attachments'
  AND (
    (storage.foldername(name))[1] = (auth.uid())::text
    OR EXISTS (
      SELECT 1
      FROM public.attachments a
      JOIN public.bugs b ON b.id = a.bug_id
      WHERE a.file_path = storage.objects.name
        AND (
          a.user_id = auth.uid()
          OR b.reporter_id = auth.uid()
          OR b.assignee_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin'::app_role)
        )
    )
  )
);

-- 2. Lock down SECURITY DEFINER function execution
REVOKE ALL ON FUNCTION public.generate_tracking_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_team_members() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_team_members() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;