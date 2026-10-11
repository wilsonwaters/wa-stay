import { DialogFrame, type DialogProps } from './Dialog';

export type SheetProps = DialogProps;

/** A Dialog that slides in from the right edge, full height: details, filters, long forms. */
export function Sheet(props: SheetProps) {
  return <DialogFrame {...props} placement="right" />;
}

export default Sheet;
