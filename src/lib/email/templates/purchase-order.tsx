import { Body, Container, Head, Heading, Hr, Html, Preview, Section, Text } from "@react-email/components";
import { Fragment } from "react";

export type PurchaseOrderEmailProps = {
  companyName: string;
  reference: string;
  supplierName: string;
  /** The user's own words, line breaks kept. */
  message: string;
  attachmentFilename: string;
  /** Who to answer: the member who sends the order. */
  issuerName: string | null;
  issuerEmail: string | null;
};

const BRAND_BLUE = "#1e3a5f";

/** The e-mail a supplier receives with a purchase order attached: the sender's message, and what is attached. */
export function PurchaseOrderEmailTemplate(props: PurchaseOrderEmailProps) {
  return (
    <Html lang="fr">
      <Head />
      <Preview>{`Bon de commande ${props.reference} - ${props.companyName}`}</Preview>
      <Body style={{ backgroundColor: "#f4f6f8", fontFamily: "Helvetica, Arial, sans-serif", margin: 0, padding: "24px 0" }}>
        <Container style={{ backgroundColor: "#ffffff", borderRadius: 6, maxWidth: 600, padding: 0 }}>
          <Section style={{ backgroundColor: BRAND_BLUE, borderRadius: "6px 6px 0 0", padding: "18px 28px" }}>
            <Heading as="h1" style={{ color: "#ffffff", fontSize: 18, margin: 0 }}>{props.companyName}</Heading>
          </Section>
          <Section style={{ padding: "22px 28px 6px" }}>
            <Heading as="h2" style={{ color: BRAND_BLUE, fontSize: 16, margin: "0 0 14px" }}>
              Bon de commande {props.reference}
            </Heading>
            {props.message ? (
              <Text style={{ color: "#182235", fontSize: 14, lineHeight: "22px", margin: 0 }}>
                {/* Mail clients drop white-space styles: each line break of the message is a real one. */}
                {props.message.split("\n").map((line, index) => (
                  <Fragment key={index}>{index > 0 ? <br /> : null}{line}</Fragment>
                ))}
              </Text>
            ) : null}
          </Section>
          <Hr style={{ borderColor: "#e2e8f0", margin: "16px 28px" }} />
          <Section style={{ padding: "0 28px 22px" }}>
            <Text style={{ color: "#64748b", fontSize: 12, lineHeight: "18px", margin: 0 }}>
              Pièce jointe : {props.attachmentFilename}, à l’attention de {props.supplierName}.
              {props.issuerEmail
                ? ` Pour toute question, répondez à ce message ou écrivez à ${props.issuerName ? `${props.issuerName} (${props.issuerEmail})` : props.issuerEmail}.`
                : ""}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
