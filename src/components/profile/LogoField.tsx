"use client";

import { useRef, useState } from "react";
import { checkLogo, LOGO_MAX_WIDTH, LOGO_TOO_BIG } from "@/lib/profile-calc";

/**
 * The logo an invoice prints in its header.
 *
 * The picture is resized here rather than on the way in to the database, and
 * that is the whole design: a person who picks a 4MB photograph finds out at
 * the moment they pick it, with a sentence saying what to do, instead of after
 * a save that fails for reasons nobody can see. The server checks the same
 * thing again (rule 5) — this is the explanation, not the gate.
 *
 * It posts through a hidden field so the form stays one `action={...}` submit.
 */
export function LogoField({ initial }: { initial: string | null }) {
  const [logo, setLogo] = useState<string>(initial ?? "");
  const [problem, setProblem] = useState<string>("");
  const picker = useRef<HTMLInputElement>(null);

  function choose(file: File) {
    setProblem("");
    const reader = new FileReader();

    reader.onerror = () => setProblem("That file could not be read.");
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => setProblem("That file is not an image this can read.");
      img.onload = () => {
        // Never scale up: a 90px logo stays 90px rather than being stretched to
        // 300 and printed soft.
        const scale = Math.min(1, LOGO_MAX_WIDTH / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setProblem("That image could not be resized.");
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const out = canvas.toDataURL("image/png");
        // A photograph resized to 300px wide is still a photograph, and PNG
        // does not compress one. The limit catches that; the wording sends
        // somebody back for a logo rather than a picture of their shopfront.
        if (out.length > 0 && checkLogo(out)) {
          setProblem(checkLogo(out) ?? LOGO_TOO_BIG);
          return;
        }
        setLogo(out);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  function remove() {
    setLogo("");
    setProblem("");
    // Without this, choosing the same file again after removing it fires no
    // change event and the control looks broken.
    if (picker.current) picker.current.value = "";
  }

  return (
    <div className="pf-logo pf-wide" data-testid="logo-field">
      <span className="field-label" id="logo-label">
        Logo
      </span>
      <p className="pf-logo-note">Optional. Prints in the header of every invoice you raise.</p>

      <div className="pf-logo-row">
        {logo ? (
          // Decorative: the business name sits beside it and says the same
          // thing, so a screen reader announcing "logo" twice helps nobody.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="pf-logo-preview" src={logo} alt="" data-testid="logo-preview" />
        ) : (
          <span className="pf-logo-empty" data-testid="logo-empty">
            No logo
          </span>
        )}

        <div className="pf-logo-actions">
          <button
            type="button"
            className="pf-logo-pick"
            onClick={() => picker.current?.click()}
            data-testid="logo-choose"
          >
            {logo ? "Change image" : "Choose image"}
          </button>

          {logo ? (
            <button type="button" className="pf-logo-rm" onClick={remove} data-testid="logo-remove">
              Remove
            </button>
          ) : null}
        </div>
      </div>

      <input
        ref={picker}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-labelledby="logo-label"
        data-testid="logo-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) choose(file);
        }}
      />

      <input type="hidden" name="logo" value={logo} data-testid="logo-value" />

      {problem ? (
        <p className="pf-logo-problem" role="status" data-testid="logo-problem">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
