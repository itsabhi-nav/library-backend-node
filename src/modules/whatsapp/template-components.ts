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

async function resolveAdmissionHeaderImage(orgId: string): Promise<string | null> {
  const meta = await loadTemplateMeta("library_admission", "en", orgId);
  if (meta?.header_type === "IMAGE" && meta.header_content?.trim()) {
    return meta.header_content.trim();
  }
  const cfg = await SimpleDatabase.query(
    `SELECT config_value FROM library_config WHERE config_key = 'login_image_url' LIMIT 1`,
    []
  );
  const url = String(cfg.rows[0]?.config_value ?? "").trim();
  return url.startsWith("http") ? url : null;
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
  variables: Record<string, unknown>
): Promise<object[]> {
  const components: object[] = [];
  let meta = await loadTemplateMeta(templateName, templateLanguage, orgId);

  let headerType = meta?.header_type ?? null;
  let headerContent = meta?.header_content ?? null;

  if (templateName === "library_admission" && headerType !== "IMAGE") {
    headerType = "IMAGE";
    headerContent = (await resolveAdmissionHeaderImage(orgId)) ?? headerContent;
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
