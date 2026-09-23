"use client";

import { useActionState, useState } from "react";
import { updateProfile, type ProfileState } from "@/app/actions/profile";
import { LogoField } from "./LogoField";
import {
  BUSINESS_TYPES,
  formatSortCode,
  missingForInvoicing,
  type Profile,
} from "@/lib/profile-calc";

const idle: ProfileState = { status: "idle" };

export function ProfileForm({ profile, email }: { profile: Profile; email: string }) {
  const [state, action, saving] = useActionState(updateProfile, idle);
  const [vat, setVat] = useState(profile.vatRegistered);

  // Worked out from what was last saved, so it answers "can I invoice today"
  // rather than "does the form look filled in".
  const missing = missingForInvoicing(profile);

  return (
    <div className="pf-app" data-testid="profile-app">
      <section
        className={`pf-status ${missing.length === 0 ? "is-ready" : "is-missing"}`}
        data-testid="invoice-readiness"
      >
        {missing.length === 0 ? (
          <p className="pf-ready">
            <strong>Ready to invoice.</strong> Everything an invoice needs is here.
          </p>
        ) : (
          <>
            <p className="pf-ready">
              <strong>An invoice raised now would be incomplete.</strong> The live suite lets one go
              out like that, and nobody finds out until a customer asks where to pay.
            </p>
            <ul className="pf-missing">
              {missing.map((m) => (
                <li key={m.field} data-testid={`missing-${m.field.replace(/\s+/g, "-").toLowerCase()}`}>
                  <strong>{m.field}</strong> — {m.why}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <form action={action} className="pf-form" data-testid="profile-form">
        <section className="pf-card">
          <h2 className="pf-h">
            The business <span className="tag">printed on every invoice</span>
          </h2>

          <div className="pf-grid">
            <label className="field app-field pf-wide">
              <span className="field-label">Business name</span>
              <input
                type="text"
                name="businessName"
                defaultValue={profile.businessName ?? ""}
                data-testid="business-name"
              />
            </label>

            <label className="field app-field">
              <span className="field-label">Type</span>
              <select
                name="businessType"
                defaultValue={profile.businessType ?? ""}
                data-testid="business-type"
              >
                <option value="">—</option>
                {BUSINESS_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            <label className="field app-field">
              <span className="field-label">Company number</span>
              <input
                type="text"
                name="companyNumber"
                defaultValue={profile.companyNumber ?? ""}
                data-testid="company-number"
              />
            </label>

            <label className="field app-field pf-wide">
              <span className="field-label">Address</span>
              <input
                type="text"
                name="businessAddress"
                defaultValue={profile.businessAddress ?? ""}
                data-testid="business-address"
              />
            </label>

            <label className="field app-field pf-wide">
              <span className="field-label">Tagline</span>
              <input
                type="text"
                name="tagline"
                defaultValue={profile.tagline ?? ""}
                data-testid="tagline"
              />
            </label>

            <LogoField initial={profile.logo} />
          </div>
        </section>

        <section className="pf-card">
          <h2 className="pf-h">
            VAT <span className="tag">only if you are registered</span>
          </h2>

          <div className="pf-grid">
            <label className="field app-field">
              <span className="field-label">VAT registered</span>
              <select
                name="vatRegistered"
                value={vat ? "yes" : "no"}
                onChange={(e) => setVat(e.target.value === "yes")}
                data-testid="vat-registered"
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </label>

            {vat ? (
              <label className="field app-field">
                <span className="field-label">VAT number</span>
                <input
                  type="text"
                  name="vatNumber"
                  defaultValue={profile.vatNumber ?? ""}
                  data-testid="vat-number"
                />
              </label>
            ) : null}
          </div>
        </section>

        <section className="pf-card">
          <h2 className="pf-h">
            Where payment goes <span className="tag">a customer reads these</span>
          </h2>

          <div className="pf-grid">
            <label className="field app-field pf-wide">
              <span className="field-label">Account name</span>
              <input
                type="text"
                name="accountName"
                defaultValue={profile.accountName ?? ""}
                data-testid="account-name"
              />
            </label>

            <label className="field app-field">
              <span className="field-label">Sort code</span>
              <input
                type="text"
                name="sortCode"
                inputMode="numeric"
                placeholder="20-00-00"
                defaultValue={formatSortCode(profile.sortCode)}
                data-testid="sort-code"
              />
            </label>

            <label className="field app-field">
              <span className="field-label">Account number</span>
              <input
                type="text"
                name="accountNo"
                inputMode="numeric"
                placeholder="12345678"
                defaultValue={profile.accountNo ?? ""}
                data-testid="account-no"
              />
            </label>
          </div>
          <p className="pf-quiet">
            Typed however you like — spaces and dashes are stripped, and an invoice prints the same
            thing every time.
          </p>
        </section>

        <section className="pf-card">
          <h2 className="pf-h">
            Invoicing <span className="tag">how yours are numbered</span>
          </h2>

          <div className="pf-grid">
            <label className="field app-field">
              <span className="field-label">Number prefix</span>
              <input
                type="text"
                name="issuerPrefix"
                placeholder="INV"
                defaultValue={profile.issuerPrefix ?? ""}
                data-testid="issuer-prefix"
              />
            </label>

            <label className="field app-field">
              <span className="field-label">Day rate (£)</span>
              <input
                type="number"
                name="dayRate"
                step="0.01"
                min="0"
                placeholder="not set"
                defaultValue={profile.dayRate ?? ""}
                data-testid="day-rate"
              />
            </label>

            <label className="field app-field">
              <span className="field-label">Payment terms (days)</span>
              <input
                type="number"
                name="paymentTermsDays"
                min="0"
                max="365"
                defaultValue={profile.paymentTermsDays}
                data-testid="payment-terms"
              />
            </label>

            <label className="field app-field">
              <span className="field-label">Contact email</span>
              <input
                type="email"
                name="contactEmail"
                defaultValue={profile.contactEmail ?? email}
                data-testid="contact-email"
              />
            </label>

            <label className="field app-field">
              <span className="field-label">Contact phone</span>
              <input
                type="text"
                name="contactPhone"
                defaultValue={profile.contactPhone ?? ""}
                data-testid="contact-phone"
              />
            </label>
          </div>
        </section>

        {state.status === "error" ? (
          <div className="msg" role="alert" data-testid="profile-error">
            {state.message}
          </div>
        ) : null}
        {state.status === "ok" ? (
          <div className="msg ok" role="status" data-testid="profile-ok">
            {state.message}
          </div>
        ) : null}

        <div>
          <button type="submit" className="primary" disabled={saving} data-testid="profile-save">
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </div>
  );
}
