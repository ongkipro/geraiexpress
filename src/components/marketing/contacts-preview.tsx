import { Search } from "lucide-react";

// Product visual (C10.6): the static look of the gerai's saved-contacts list (/kontak: search field,
// name, phone, the roles a contact was used in), with invented sample contacts. Hidden from assistive
// technology and described by its caption, like the other marketing panels.
const SAMPLE_CONTACTS = [
  { name: "Ibu Contoh", phone: "0812 0000 0001", place: "Coblong, Kota Bandung", roles: ["Penerima"] },
  { name: "Toko Contoh", phone: "0812 0000 0002", place: "Sukajadi, Kota Bandung", roles: ["Pengirim"] },
  { name: "Pak Contoh", phone: "0812 0000 0003", place: "Kota Surabaya", roles: ["Pengirim", "Penerima"] },
] as const;

export function ContactsPreview() {
  return (
    <figure className="flex flex-col gap-3">
      <div aria-hidden="true" className="rounded-lg bg-card p-5 ring-1 ring-border sm:p-6">
        <p className="text-[17px] font-semibold">Kontak</p>
        <div className="mt-3 flex min-h-11 items-center gap-2 rounded-sm px-3 text-[15px] text-muted-foreground ring-1 ring-input">
          <Search className="size-4 shrink-0" />
          Nama atau nomor HP
        </div>
        <ul className="mt-4 flex flex-col divide-y divide-border">
          {SAMPLE_CONTACTS.map((contact) => (
            <li key={contact.name} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold text-primary">{contact.name}</span>
                <span className="tabular text-sm text-muted-foreground">
                  {contact.phone} · {contact.place}
                </span>
              </span>
              <span className="flex gap-1.5">
                {contact.roles.map((role) => (
                  <span key={role} className="rounded-full bg-muted px-2.5 py-0.5 text-sm ring-1 ring-border">
                    {role}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="text-sm text-muted-foreground">
        Ilustrasi daftar kontak tersimpan dengan data contoh. Kontak dipilih lagi saat membuat kiriman berikutnya.
      </figcaption>
    </figure>
  );
}
