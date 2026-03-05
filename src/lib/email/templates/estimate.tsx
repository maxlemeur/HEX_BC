import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export type EstimateEmailProps = {
  projectName: string;
  versionNumber: number;
  totalTtcFormatted: string;
  portalUrl: string;
  message: string;
  companyName: string;
};

const BRAND_BLUE = "#1e3a5f";
const BRAND_ORANGE = "#e8732f";

export function EstimateEmailTemplate({
  projectName,
  versionNumber,
  totalTtcFormatted,
  portalUrl,
  message,
  companyName,
}: EstimateEmailProps) {
  return (
    <Html lang="fr">
      <Head />
      <Preview>{`Devis V${versionNumber} - ${projectName}`}</Preview>
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
              Devis - {projectName}
            </Heading>
            <Text style={versionBadgeStyle}>Version V{versionNumber}</Text>
          </Section>

          {/* Custom message */}
          <Section style={contentStyle}>
            <Text style={messageStyle}>{message}</Text>
          </Section>

          <Hr style={hrStyle} />

          {/* Total */}
          <Section style={contentStyle}>
            <Text style={totalLabelStyle}>Montant TTC</Text>
            <Text style={totalValueStyle}>{totalTtcFormatted}</Text>
          </Section>

          {/* CTA */}
          <Section style={ctaSectionStyle}>
            <Link href={portalUrl} style={ctaButtonStyle}>
              Consulter le devis
            </Link>
          </Section>

          <Hr style={hrStyle} />

          {/* Footer */}
          <Section style={contentStyle}>
            <Text style={footerStyle}>
              Ce devis vous a ete transmis par {companyName}. Vous pouvez le
              consulter, l&apos;accepter ou le refuser en ligne via le lien
              ci-dessus.
            </Text>
            <Text style={footerStyle}>
              Si vous avez des questions, contactez directement votre
              interlocuteur.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default EstimateEmailTemplate;

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

const messageStyle: React.CSSProperties = {
  color: "#3f3f46",
  fontSize: "15px",
  lineHeight: "1.6",
  whiteSpace: "pre-line",
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

const ctaSectionStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "8px 32px 24px",
};

const ctaButtonStyle: React.CSSProperties = {
  display: "inline-block",
  backgroundColor: BRAND_BLUE,
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 600,
  padding: "12px 28px",
  borderRadius: "8px",
  textDecoration: "none",
};

const footerStyle: React.CSSProperties = {
  color: "#a1a1aa",
  fontSize: "12px",
  lineHeight: "1.5",
  marginBottom: "8px",
};
