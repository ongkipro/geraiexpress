// T-072 / UX-15: the intake form's one select pattern, on the shared Radix Select. Arrow keys,
// type-ahead and Escape come with it; the value is a plain string so the form keeps its controlled
// values. A `name` makes Radix mirror the value into a hidden native <select> inside the form, so
// FormData carries it exactly like a native control (pickup date, slot and vehicle). An `emptyLabel`
// adds a selectable "nothing chosen" item that maps back to "" (Radix items cannot use ""); it is
// meant for unnamed pickers (saved contacts), where the empty choice means "fill in by hand".
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const EMPTY = "__kosong__";

export type ChoiceOption = { value: string; label: string; disabled?: boolean };

export function ChoiceSelect({ id, name, value, onValueChange, options, placeholder, emptyLabel, invalid, describedBy }: {
  id: string;
  name?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: ChoiceOption[];
  placeholder?: string;
  emptyLabel?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <Select name={name} value={value === "" && emptyLabel ? EMPTY : value} onValueChange={(v) => onValueChange(v === EMPTY ? "" : v)}>
      <SelectTrigger id={id} className="w-full min-w-0 rounded-sm [&>[data-slot=select-value]]:min-w-0 [&>[data-slot=select-value]]:truncate"
        aria-invalid={invalid || undefined} aria-describedby={describedBy}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" align="start" className="max-h-80 max-w-[calc(100vw-2rem)]">
        {emptyLabel ? <SelectItem value={EMPTY} className="min-h-11 text-base">{emptyLabel}</SelectItem> : null}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled} className="min-h-11 text-base">{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
