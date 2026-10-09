import { cleanup,render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  params: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(navigation.params),
}));

vi.mock("./ApprovalQueueCardList", () => ({
  ApprovalQueueCardList: () => <div data-testid="approval-list" />,
}));

import { ApprovalQueuePage } from "./ApprovalQueuePage";

function renderPage(
  overrides: Partial<React.ComponentProps<typeof ApprovalQueuePage>> = {}
) {
  render(
    <ApprovalQueuePage
      initialData={[]}
      initialSortBy="priority"
      initialSortDir="desc"
      initialOnlyExceptions={false}
      {...overrides}
    />
  );
}

describe("ApprovalQueuePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.params = "";
  });

  afterEach(() => {
    cleanup();
  });

  it("lets an initially active exception filter be disabled", async () => {
    const user = userEvent.setup();
    renderPage({ initialOnlyExceptions: true });

    const checkbox = screen.getByRole("checkbox", {
      name: "Exceptions seulement",
    });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);

    expect(navigation.push).toHaveBeenCalledWith(
      "/dashboard/approvals?onlyExceptions=false"
    );
  });

  it("honors an explicit false URL value over the initial filter", () => {
    navigation.params = "onlyExceptions=false";
    renderPage({ initialOnlyExceptions: true });

    expect(
      screen.getByRole("checkbox", { name: "Exceptions seulement" })
    ).not.toBeChecked();
  });
});
