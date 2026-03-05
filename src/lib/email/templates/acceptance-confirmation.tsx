import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export type AcceptanceConfirmationEmailProps = {
  projectName: string;
  versionNumber: number;
  totalTtcFormatted: string;
  acceptedAt: string;
  companyName: string;
};

const BRAND_BLUE = "#1e3a5f";
const BRAND_ORANGE = "#e8732f";

export function AcceptanceConfirmationEmailTemplate({
  projectName,
  versionNumber,
  totalTtcFormatted,
  acceptedAt,
  companyName,
}: AcceptanceConfirmationEmailProps) {
  return (
    <Html lang="fr">
      <Head />
      <Preview>{`Devis V${versionNumber} accepte - ${projectName}`}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          {/* Header */}
          <Section style={headerStyle}>
            <Heading as="h1" style={logoTextStyle}>
              {companyName}
            </Heading>
          </Section>

          {/* Title */}
          <Section style={contentStyle}>
            <Heading as="h2" style={titleStyle}>
              Devis accepte - {projectName}
            </Heading>
            <Text style={versionBadgeStyle}>Version V{versionNumber}</Text>
          </Section>

          {/* Confirmation */}
          <Section style={contentStyle}>
            <div style={confirmationBoxStyle}>
              <Text style={confirmationTextStyle}>
                Votre devis a bien ete accepte le {acceptedAt}.
              </Text>
            </div>
          </Section>

          <Hr style={hrStyle} />

          {/* Total */}
          <Section style={contentStyle}>
            <Text style={totalLabelStyle}>Montant TTC</Text>
            <Text style={totalValueStyle}>{totalTtcFormatted}</Text>
          </Section>

          <Hr style={hrStyle} />

          {/* Footer */}
          <Section style={contentStyle}>
            <Text style={footerStyle}>
              Ce message est un accuse de reception automatique envoye par{" "}
              {companyName}. Un interlocuteur vous contactera prochainement pour
              la suite du projet.
            </Text>
            <Text style={footerStyle}>Merci pour votre confiance.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default AcceptanceConfirmationEmailTemplate;

// ---------------------------------------------------------------------------
// Styles (inline for email compatibility)
// ---------------------------------------------------------------------------

const bodyStyle: React.CSSProperties = {
  backgroundColor: "#f4f4f5",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  margin: 0,
  padding: 0,
};

const containerStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  maxWidth: "600px",
  margin: "40px auto",
  borderRadius: "8px",
  overflow: "hidden",
  border: "1px solid #e4e4e7",
};

const headerStyle: React.CSSProperties = {
  backgroundColor: BRAND_BLUE,
  padding: "24px 32px",
};

const logoTextStyle: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "18px",
  fontWeight: 700,
  margin: 0,
};

const contentStyle: React.CSSProperties = {
  padding: "0 32px",
};

const titleStyle: React.CSSProperties = {
  color: BRAND_BLUE,
  fontSize: "22px",
  fontWeight: 700,
  marginTop: "28px",
  marginBottom: "4px",
};

const versionBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  backgroundColor: `${BRAND_ORANGE}1a`,
  color: BRAND_ORANGE,
  fontSize: "13px",
  fontWeight: 700,
  fontFamily: "monospace",
  padding: "4px 10px",
  borderRadius: "6px",
  marginTop: "0",
  marginBottom: "16px",
};

const confirmationBoxStyle: React.CSSProperties = {
  backgroundColor: "#d1fae5",
  border: "1px solid #a7f3d0",
  borderRadius: "8px",
  padding: "16px 20px",
};

const confirmationTextStyle: React.CSSProperties = {
  color: "#065f46",
  fontSize: "15px",
  fontWeight: 600,
  lineHeight: "1.5",
  margin: 0,
};

const hrStyle: React.CSSProperties = {
  borderColor: "#e4e4e7",
  margin: "24px 32px",
};

const totalLabelStyle: React.CSSProperties = {
  color: "#71717a",
  fontSize: "13px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: "2px",
};

const totalValueStyle: React.CSSProperties = {
  color: BRAND_BLUE,
  fontSize: "28px",
  fontWeight: 700,
  marginTop: "0",
  marginBottom: "8px",
};

const footerStyle: React.CSSProperties = {
  color: "#a1a1aa",
  fontSize: "12px",
  lineHeight: "1.5",
  marginBottom: "8px",
};
