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

export type ApprovalReviewRequestEmailProps = {
  reviewerName: string;
  requesterName: string;
  projectName: string;
  versionNumber: number;
  companyName: string;
  submissionMessage?: string | null;
  ruleLabels: string[];
};

const BRAND_BLUE = "#1e3a5f";
const BRAND_ORANGE = "#e8732f";

export function ApprovalReviewRequestEmailTemplate({
  reviewerName,
  requesterName,
  projectName,
  versionNumber,
  companyName,
  submissionMessage,
  ruleLabels,
}: ApprovalReviewRequestEmailProps) {
  return (
    <Html lang="fr">
      <Head />
      <Preview>{`Validation requise - ${projectName} V${versionNumber}`}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section style={headerStyle}>
            <Heading as="h1" style={logoTextStyle}>
              {companyName}
            </Heading>
          </Section>

          <Section style={contentStyle}>
            <Heading as="h2" style={titleStyle}>
              Nouvelle demande de validation
            </Heading>
            <Text style={introStyle}>
              {reviewerName}, {requesterName} a soumis la version V{versionNumber} de{" "}
              {projectName} pour revue.
            </Text>
          </Section>

          {submissionMessage ? (
            <Section style={contentStyle}>
              <Text style={sectionLabelStyle}>Message de contexte</Text>
              <Text style={messageStyle}>{submissionMessage}</Text>
            </Section>
          ) : null}

          <Hr style={hrStyle} />

          <Section style={contentStyle}>
            <Text style={sectionLabelStyle}>Regles declenchees</Text>
            {ruleLabels.length > 0 ? (
              ruleLabels.map((ruleLabel) => (
                <Text key={ruleLabel} style={listItemStyle}>
                  - {ruleLabel}
                </Text>
              ))
            ) : (
              <Text style={messageStyle}>
                La version contient au moins une demande d&apos;approbation a traiter.
              </Text>
            )}
          </Section>

          <Hr style={hrStyle} />

          <Section style={contentStyle}>
            <Text style={footerStyle}>
              Ouvrez l&apos;application Hydro Express pour consulter le dossier, le contexte
              de soumission et les points de validation associes.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

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
  marginBottom: "12px",
};

const introStyle: React.CSSProperties = {
  color: "#3f3f46",
  fontSize: "15px",
  lineHeight: "1.6",
  marginTop: 0,
};

const sectionLabelStyle: React.CSSProperties = {
  color: BRAND_ORANGE,
  fontSize: "13px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: "8px",
};

const messageStyle: React.CSSProperties = {
  color: "#3f3f46",
  fontSize: "15px",
  lineHeight: "1.6",
  whiteSpace: "pre-line",
  marginTop: 0,
};

const listItemStyle: React.CSSProperties = {
  color: "#3f3f46",
  fontSize: "14px",
  lineHeight: "1.5",
  marginTop: 0,
  marginBottom: "6px",
};

const hrStyle: React.CSSProperties = {
  borderColor: "#e4e4e7",
  margin: "24px 32px",
};

const footerStyle: React.CSSProperties = {
  color: "#71717a",
  fontSize: "12px",
  lineHeight: "1.5",
  marginBottom: "28px",
};
