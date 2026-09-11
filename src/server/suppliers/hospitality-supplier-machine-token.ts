const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

export function isExactHospitalitySupplierMachineToken(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && Number.isSafeInteger(maxLength)
    && maxLength > 0
    && value.length >= 1
    && value.length <= maxLength
    && value.trim() === value
    && !ASCII_CONTROL_PATTERN.test(value);
}
