
CREATE TABLE public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, reviewer_id)
);

GRANT SELECT ON public.reviews TO anon, authenticated;
GRANT INSERT ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reviews are public read" ON public.reviews
  FOR SELECT USING (true);

CREATE POLICY "party can insert review after release" ON public.reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    reviewer_id = auth.uid()
    AND reviewer_id <> reviewee_id
    AND EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_id
        AND c.status IN ('approved_released','refunded')
        AND (
          (c.client_id = auth.uid() AND c.freelancer_id = reviewee_id)
          OR (c.freelancer_id = auth.uid() AND c.client_id = reviewee_id)
        )
    )
  );

CREATE INDEX idx_reviews_reviewee ON public.reviews (reviewee_id, created_at DESC);
CREATE INDEX idx_reviews_contract ON public.reviews (contract_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.reviews;
ALTER TABLE public.reviews REPLICA IDENTITY FULL;
