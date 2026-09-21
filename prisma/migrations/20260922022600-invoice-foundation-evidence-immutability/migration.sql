CREATE FUNCTION sf_guard_invoice_issuer_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'invoice issuer profile is immutable'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER invoice_issuer_profile_update_guard
BEFORE UPDATE ON "invoice_issuer_profiles"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_invoice_issuer_profile_update();

CREATE FUNCTION sf_guard_hospitality_invoice_preparation_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'hospitality invoice preparation is immutable'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER hospitality_invoice_preparation_update_guard
BEFORE UPDATE ON "hospitality_invoice_preparations"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_hospitality_invoice_preparation_update();
