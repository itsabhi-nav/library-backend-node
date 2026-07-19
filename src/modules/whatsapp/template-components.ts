import { SimpleDatabase } from "../../core/database/SimpleDatabase";

interface TemplateMeta {
  header_type: string | null;
  header_content: string | null;
}

async function loadTemplateMeta(
  templateName: string,
  templateLanguage: string,
  orgId: string
): Promise<TemplateMeta | null> {
  try {
    const res = await SimpleDatabase.query(
      `SELECT header_type, header_content FROM whatsapp_templates
       WHERE template_name = $1 AND template_language = $2 AND org_id = $3 LIMIT 1`,
      [templateName, templateLanguage, orgId]
    );
    return res.rows[0] ?? null;
  } catch {
    return null;
  }
}

// Meta requires a *publicly reachable* https image for an IMAGE header. If the
// template metadata / config only has a relative asset path (e.g. /school.png),
// the send would fail, so fall back to this hosted default to guarantee delivery.
const DEFAULT_ADMISSION_IMAGE =
  "https://res.cloudinary.com/dcahaaigp/image/upload/v1781909500/school_tfd0v6.png";

async function resolveAdmissionHeaderImage(orgId: string): Promise<string> {
  const meta = await loadTemplateMeta("library_admission", "en", orgId);
  if (meta?.header_type === "IMAGE" && meta.header_content?.trim().startsWith("http")) {
    return meta.header_content.trim();
  }
  const cfg = await SimpleDatabase.query(
    `SELECT config_value FROM library_config WHERE config_key = 'login_image_url' LIMIT 1`,
    []
  );
  const url = String(cfg.rows[0]?.config_value ?? "").trim();
  return url.startsWith("http") ? url : DEFAULT_ADMISSION_IMAGE;
}

function buildHeaderComponent(headerType: string, headerContent: string | null): object | null {
  if (headerType === "IMAGE" && headerContent) {
    return {
      type: "header",
      parameters: [{ type: "image", image: { link: headerContent } }],
    };
  }
  return null;
}

/** Build Meta template components (header + body) from DB template metadata. */
export async function buildTemplateComponents(
  templateName: string,
  templateLanguage: string,
  orgId: string,
  variables: Record<string, unknown>,
  headerImageId?: string | null
): Promise<object[]> {
  const components: object[] = [];
  let meta = await loadTemplateMeta(templateName, templateLanguage, orgId);

  let headerType = meta?.header_type ?? null;
  let headerContent = meta?.header_content ?? null;

  // A per-send uploaded image (Meta media id) overrides the template's stored
  // header link — used by admin announcements where the image differs each time.
  if (headerImageId) {
    components.push({
      type: "header",
      parameters: [{ type: "image", image: { id: headerImageId } }],
    });
    if (variables && Object.keys(variables).length > 0) {
      const bodyParams = Object.entries(variables)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, v]) => ({ type: "text", text: String(v) }));
      components.push({ type: "body", parameters: bodyParams });
    }
    return components;
  }

  // The welcome/admission message always ships with an image header; make sure
  // we send a valid public https image even if the template row/config is empty
  // or points at a relative path.
  if (templateName === "library_admission") {
    headerType = "IMAGE";
    if (!headerContent || !headerContent.trim().startsWith("http")) {
      headerContent = await resolveAdmissionHeaderImage(orgId);
    }
  }

  if (headerType) {
    const header = buildHeaderComponent(headerType, headerContent);
    if (header) components.push(header);
  }

  if (variables && Object.keys(variables).length > 0) {
    const bodyParams = Object.entries(variables)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => ({ type: "text", text: String(v) }));
    components.push({ type: "body", parameters: bodyParams });
  }

  return components;
}
