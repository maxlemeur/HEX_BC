"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EstimateEditorTable } from "@/components/estimates/EstimateEditorTable";
import {
  EstimateSettingsPanel,
  type EstimateSettingsState,
} from "@/components/estimates/EstimateSettingsPanel";
import { LaborRolesManager } from "@/components/estimates/LaborRolesManager";
import { useUserContext } from "@/components/UserContext";
import {
  computeEstimateLineValues,
  computeEstimateTotals,
  type EstimateTotals,
} from "@/lib/estimate-calculations";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type EstimateVersionRow =
  Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type EstimateCategory =
  Database["public"]["Tables"]["estimate_categories"]["Row"];
type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];
type EstimateStatus = Database["public"]["Enums"]["estimate_status"];

type EstimateVersionView = EstimateVersionRow & {
  estimate_projects: { name: string } | { name: string }[] | null;
};

type ItemPatch = Partial<
  Pick<
    EstimateItem,
    | "title"
    | "description"
    | "quantity"
    | "unit_price_ht_cents"
    | "tax_rate_bp"
    | "k_fo"
    | "h_mo"
    | "k_mo"
    | "pu_ht_cents"
    | "labor_role_id"
    | "category_id"
  >
>;

function getProjectName(
  value: EstimateVersionView["estimate_projects"]
) {
  if (!value) return "";
  if (Array.isArray(value)) return value[0]?.name ?? "";
  return value.name ?? "";
}

function computeInitialDiscountCents(
  version: EstimateVersionRow,
  items: EstimateItem[],
  laborRoles: LaborRole[]
) {
  const rateById = new Map<string, number>();
  laborRoles.forEach((role) => {
    rateById.set(role.id, role.hourly_rate_cents);
  });

  const saleSubtotal = items.reduce((sum, item) => {
    if (item.item_type !== "line") return sum;
    const hourlyRate = item.labor_role_id
      ? rateById.get(item.labor_role_id) ?? 0
      : 0;
    const lineValues = computeEstimateLineValues(
      {
        ...item,
        labor_role_hourly_rate_cents: hourlyRate,
      },
      {
        marginMultiplier: version.margin_multiplier,
        taxRateBp: version.tax_rate_bp,
      }
    );
    return sum + lineValues.saleLineCents;
  }, 0);

  if (!saleSubtotal) return 0;
  return Math.round((saleSubtotal * version.discount_bp) / 10000);
}

function estimateStatusLabel(status: EstimateStatus) {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "sent":
      return "Envoyee";
    case "accepted":
      return "Acceptee";
    case "archived":
      return "Archivee";
    default:
      return status;
  }
}

function estimateStatusClass(status: EstimateStatus) {
  switch (status) {
    case "draft":
      return "status-badge status-draft";
    case "sent":
      return "status-badge status-sent";
    case "accepted":
      return "status-badge status-accepted";
    case "archived":
      return "status-badge status-archived";
    default:
      return "status-badge status-draft";
  }
}

function resolveEstimateActionError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("row-level security") || normalized.includes("read-only")) {
    return "Cette version est en lecture seule.";
  }
  return message;
}

export default function EditEstimatePage() {
  const params = useParams();
  const rawVersionId = params?.["versionId"];
  const versionId = Array.isArray(rawVersionId) ? rawVersionId[0] : rawVersionId;
  const resolvedVersionId = typeof versionId === "string" ? versionId : "";
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { profile } = useUserContext();

  const [version, setVersion] = useState<EstimateVersionView | null>(null);
  const [settings, setSettings] = useState<EstimateSettingsState | null>(null);
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [categories, setCategories] = useState<EstimateCategory[]>([]);
  const [laborRoles, setLaborRoles] = useState<LaborRole[]>([]);
  const [activeTab, setActiveTab] = useState<"settings" | "editor">("settings");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const itemsRef = useRef<EstimateItem[]>([]);
  const lastTotalsKey = useRef<string | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (!resolvedVersionId) return;

    let active = true;

    async function load() {
      setIsLoading(true);
      setLoadError(null);

      const versionPromise = supabase
        .from("estimate_versions")
        .select("*, estimate_projects ( name )")
        .eq("id", resolvedVersionId)
        .single();

      const itemsPromise = supabase
        .from("estimate_items")
        .select("*")
        .eq("version_id", resolvedVersionId)
        .order("position", { ascending: true });

      const categoriesPromise = supabase
        .from("estimate_categories")
        .select("*")
        .order("position", { ascending: true });

      const rolesPromise = supabase
        .from("labor_roles")
        .select("*")
        .order("position", { ascending: true });

      const [versionResult, itemsResult, categoriesResult, rolesResult] =
        await Promise.all([
          versionPromise,
          itemsPromise,
          categoriesPromise,
          rolesPromise,
        ]);

      if (!active) return;

      if (versionResult.error) {
        setLoadError(versionResult.error.message);
        setIsLoading(false);
        return;
      }

      if (itemsResult.error) {
        setLoadError(itemsResult.error.message);
        setIsLoading(false);
        return;
      }

      if (categoriesResult.error) {
        setLoadError(categoriesResult.error.message);
        setIsLoading(false);
        return;
      }

      if (rolesResult.error) {
        setLoadError(rolesResult.error.message);
        setIsLoading(false);
        return;
      }

      const versionRow = versionResult.data as unknown as EstimateVersionView;
      const itemsRows = itemsResult.data ?? [];
      const rolesData = rolesResult.data ?? [];
      const discountCents = computeInitialDiscountCents(
        versionRow,
        itemsRows,
        rolesData
      );

      const rateById = new Map<string, number>();
      rolesData.forEach((role) => {
        rateById.set(role.id, role.hourly_rate_cents);
      });

      const normalizedItems = itemsRows.map((item) => {
        if (item.item_type !== "line") return item;
        const kFo = item.k_fo ?? 1;
        const hMo = item.h_mo ?? 0;
        const kMo = item.k_mo ?? 1;
        const hourlyRate = item.labor_role_id
          ? rateById.get(item.labor_role_id) ?? 0
          : 0;
        const taxRate = versionRow.tax_rate_bp ?? item.tax_rate_bp ?? 0;
        const lineValues = computeEstimateLineValues(
          {
            ...item,
            k_fo: kFo,
            h_mo: hMo,
            k_mo: kMo,
            tax_rate_bp: taxRate,
            labor_role_hourly_rate_cents: hourlyRate,
          },
          {
            marginMultiplier: versionRow.margin_multiplier,
            taxRateBp: taxRate,
          }
        );
        return {
          ...item,
          tax_rate_bp: taxRate,
          k_fo: kFo,
          h_mo: hMo,
          k_mo: kMo,
          pu_ht_cents: lineValues.puHtCents,
          line_total_ht_cents: lineValues.saleLineCents,
          line_tax_cents: lineValues.taxLineCents,
          line_total_ttc_cents: lineValues.ttcLineCents,
        };
      });

      setVersion(versionRow);
      setItems(normalizedItems);
      setCategories(categoriesResult.data ?? []);
      setLaborRoles(rolesData);
      setSettings({
        title: versionRow.title ?? "",
        date_devis: versionRow.date_devis,
        validite_jours: versionRow.validite_jours,
        margin_multiplier: versionRow.margin_multiplier,
        discount_cents: discountCents,
        tax_rate_bp: versionRow.tax_rate_bp,
        rounding_mode: versionRow.rounding_mode,
        rounding_step_cents: versionRow.rounding_step_cents,
      });
      setIsLoading(false);

      if (versionRow.status === "draft") {
        const originalById = new Map(
          itemsRows.map((item) => [item.id, item])
        );
        const updates = normalizedItems.filter((item) => {
          if (item.item_type !== "line") return false;
          const original = originalById.get(item.id);
          if (!original) return false;
          return (
            original.tax_rate_bp !== item.tax_rate_bp ||
            original.k_fo !== item.k_fo ||
            original.h_mo !== item.h_mo ||
            original.k_mo !== item.k_mo ||
            original.pu_ht_cents !== item.pu_ht_cents ||
            original.line_total_ht_cents !== item.line_total_ht_cents ||
            original.line_tax_cents !== item.line_tax_cents ||
            original.line_total_ttc_cents !== item.line_total_ttc_cents
          );
        });

        if (updates.length > 0) {
          const results = await Promise.all(
            updates.map((item) =>
              supabase
                .from("estimate_items")
                .update({
                  tax_rate_bp: item.tax_rate_bp,
                  k_fo: item.k_fo,
                  h_mo: item.h_mo,
                  k_mo: item.k_mo,
                  pu_ht_cents: item.pu_ht_cents,
                  line_total_ht_cents: item.line_total_ht_cents,
                  line_tax_cents: item.line_tax_cents,
                  line_total_ttc_cents: item.line_total_ttc_cents,
                })
                .eq("id", item.id)
            )
          );
          if (active && results.some((result) => result.error)) {
            setActionError("Impossible de mettre a jour les lignes.");
          }
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [resolvedVersionId, supabase]);

  const projectName = getProjectName(version?.estimate_projects ?? null);
  const isReadOnly = version ? version.status !== "draft" : false;
  const canSend = version?.status === "draft";
  const canAccept = version?.status === "sent";
  const canArchive = version?.status !== "archived";

  const laborRateById = useMemo(() => {
    const map = new Map<string, number>();
    laborRoles.forEach((role) => {
      map.set(role.id, role.hourly_rate_cents);
    });
    return map;
  }, [laborRoles]);

  const totals: EstimateTotals | null = useMemo(() => {
    if (!settings) return null;
    const lineItems = items
      .filter((item) => item.item_type === "line")
      .map((item) => ({
        ...item,
        labor_role_hourly_rate_cents: item.labor_role_id
          ? laborRateById.get(item.labor_role_id) ?? 0
          : 0,
      }));
    return computeEstimateTotals({
      lineItems,
      marginMultiplier: settings.margin_multiplier,
      discountCents: settings.discount_cents,
      taxRateBp: settings.tax_rate_bp,
      roundingMode: settings.rounding_mode,
      roundingStepCents: settings.rounding_step_cents,
    });
  }, [items, laborRateById, settings]);

  useEffect(() => {
    if (!totals || !version || isReadOnly) return;
    const totalsKey = `${totals.saleTotalCents}-${totals.adjustedTaxCents}-${totals.roundedTtcCents}`;
    if (totalsKey === lastTotalsKey.current) return;

    const timeout = setTimeout(async () => {
      const { error } = await supabase
        .from("estimate_versions")
        .update({
          total_ht_cents: totals.saleTotalCents,
          total_tax_cents: totals.adjustedTaxCents,
          total_ttc_cents: totals.roundedTtcCents,
        })
        .eq("id", version.id);

      if (!error) {
        lastTotalsKey.current = totalsKey;
      }
    }, 400);

    return () => clearTimeout(timeout);
  }, [isReadOnly, totals, supabase, version]);

  const updateSettings = useCallback(
    (patch: Partial<EstimateSettingsState>) => {
      setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    },
    []
  );

  const reloadItems = useCallback(async () => {
    if (!resolvedVersionId) return;
    const { data, error } = await supabase
      .from("estimate_items")
      .select("*")
      .eq("version_id", resolvedVersionId)
      .order("position", { ascending: true });

    if (error) {
      setActionError(resolveEstimateActionError(error.message));
      return;
    }

    setItems(data ?? []);
  }, [resolvedVersionId, supabase]);

  async function handleSaveSettings() {
    if (!settings || !version || !totals) return;
    if (isReadOnly) {
      setActionError("Cette version est en lecture seule.");
      return;
    }
    setIsSavingSettings(true);
    setActionError(null);

    const discountBase = totals.saleSubtotalCents;
    const discountBp =
      discountBase > 0
        ? Math.round((settings.discount_cents / discountBase) * 10000)
        : 0;

    const payload: Database["public"]["Tables"]["estimate_versions"]["Update"] = {
      title: settings.title.trim() || null,
      date_devis: settings.date_devis,
      validite_jours: settings.validite_jours,
      margin_multiplier: settings.margin_multiplier,
      discount_bp: discountBp,
      tax_rate_bp: settings.tax_rate_bp,
      rounding_mode: settings.rounding_mode,
      rounding_step_cents: settings.rounding_step_cents,
      total_ht_cents: totals.saleTotalCents,
      total_tax_cents: totals.adjustedTaxCents,
      total_ttc_cents: totals.roundedTtcCents,
    };

    const { error } = await supabase
      .from("estimate_versions")
      .update(payload)
      .eq("id", version.id);

    if (error) {
      setActionError(resolveEstimateActionError(error.message));
      setIsSavingSettings(false);
      return;
    }

    const shouldUpdateLines =
      settings.tax_rate_bp !== version.tax_rate_bp ||
      settings.margin_multiplier !== version.margin_multiplier;

    if (shouldUpdateLines) {
      const lineItems = itemsRef.current.filter(
        (item) => item.item_type === "line"
      );
      const updatedLines = lineItems.map((item) => {
        const kFo = item.k_fo ?? 1;
        const hMo = item.h_mo ?? 0;
        const kMo = item.k_mo ?? 1;
        const hourlyRate = item.labor_role_id
          ? laborRateById.get(item.labor_role_id) ?? 0
          : 0;
        const lineValues = computeEstimateLineValues(
          {
            ...item,
            tax_rate_bp: settings.tax_rate_bp,
            k_fo: kFo,
            h_mo: hMo,
            k_mo: kMo,
            labor_role_hourly_rate_cents: hourlyRate,
          },
          {
            marginMultiplier: settings.margin_multiplier,
            taxRateBp: settings.tax_rate_bp,
          }
        );
        return {
          ...item,
          tax_rate_bp: settings.tax_rate_bp,
          k_fo: kFo,
          h_mo: hMo,
          k_mo: kMo,
          pu_ht_cents: lineValues.puHtCents,
          line_total_ht_cents: lineValues.saleLineCents,
          line_tax_cents: lineValues.taxLineCents,
          line_total_ttc_cents: lineValues.ttcLineCents,
        };
      });

      setItems((prev) =>
        prev.map((item) => {
          if (item.item_type !== "line") return item;
          const updated = updatedLines.find((line) => line.id === item.id);
          return updated ?? item;
        })
      );

      const updates = await Promise.all(
        updatedLines.map((item) =>
          supabase
            .from("estimate_items")
            .update({
              tax_rate_bp: item.tax_rate_bp,
              k_fo: item.k_fo,
              h_mo: item.h_mo,
              k_mo: item.k_mo,
              pu_ht_cents: item.pu_ht_cents,
              line_total_ht_cents: item.line_total_ht_cents,
              line_tax_cents: item.line_tax_cents,
              line_total_ttc_cents: item.line_total_ttc_cents,
            })
            .eq("id", item.id)
        )
      );

      const hasError = updates.some((result) => result.error);
      if (hasError) {
        setActionError("Impossible de mettre a jour les lignes.");
      }
    }

    setVersion((prev) => (prev ? { ...prev, ...payload } : prev));
    setIsSavingSettings(false);
  }

  const handleEnsureCategory = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const existing = categories.find(
        (category) => category.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (existing) return existing;

      if (!profile?.id) {
        setActionError("Impossible de charger votre profil.");
        return null;
      }

      const nextPosition =
        categories.reduce((max, category) => Math.max(max, category.position), 0) +
        1;

      const { data, error } = await supabase
        .from("estimate_categories")
        .insert({
          user_id: profile.id,
          name: trimmed,
          color: null,
          position: nextPosition,
        })
        .select("*")
        .single();

      if (error || !data) {
        setActionError(error?.message ?? "Impossible de creer la categorie.");
        return null;
      }

      setCategories((prev) =>
        [...prev, data].sort((a, b) => a.position - b.position)
      );
      return data;
    },
    [categories, profile, supabase]
  );

  const handleCreateRole = useCallback(
    async (payload: { name: string; hourly_rate_cents: number }) => {
      setActionError(null);
      if (!profile?.id) {
        setActionError("Impossible de charger votre profil.");
        return;
      }

      const nextPosition =
        laborRoles.reduce((max, role) => Math.max(max, role.position), 0) + 1;

      const { data, error } = await supabase
        .from("labor_roles")
        .insert({
          user_id: profile.id,
          name: payload.name,
          hourly_rate_cents: payload.hourly_rate_cents,
          is_active: true,
          position: nextPosition,
        })
        .select("*")
        .single();

      if (error || !data) {
        setActionError(error?.message ?? "Impossible de creer le role.");
        return;
      }

      setLaborRoles((prev) =>
        [...prev, data].sort((a, b) => a.position - b.position)
      );
    },
    [laborRoles, profile, supabase]
  );

  const handleUpdateRole = useCallback(
    async (id: string, updates: Partial<LaborRole>) => {
      setActionError(null);
      const { error } = await supabase
        .from("labor_roles")
        .update(updates)
        .eq("id", id);

      if (error) {
        setActionError(error.message);
        return;
      }

      setLaborRoles((prev) =>
        prev.map((role) => (role.id === id ? { ...role, ...updates } : role))
      );
    },
    [supabase]
  );

  const getNextPosition = useCallback((parentId: string | null) => {
    const siblings = itemsRef.current.filter(
      (item) => item.parent_id === parentId
    );
    const maxPosition = siblings.reduce(
      (max, item) => Math.max(max, item.position),
      0
    );
    return maxPosition + 1;
  }, []);

  const handleAddSection = useCallback(
    async (parentId: string | null) => {
      if (!version) return;
      if (isReadOnly) {
        setActionError("Cette version est en lecture seule.");
        return;
      }
      setActionError(null);
      const position = getNextPosition(parentId);

      const { data, error } = await supabase
        .from("estimate_items")
        .insert({
          version_id: version.id,
          parent_id: parentId,
          item_type: "section",
          position,
          title: parentId ? "Nouveau sous-chapitre" : "Nouveau chapitre",
        })
        .select("*")
        .single();

      if (error || !data) {
        setActionError(
          resolveEstimateActionError(
            error?.message ?? "Impossible de creer le chapitre."
          )
        );
        return;
      }

      setItems((prev) => [...prev, data]);
    },
    [getNextPosition, isReadOnly, supabase, version]
  );

  const handleAddLine = useCallback(
    async (parentId: string | null) => {
      if (!version || !settings) return;
      if (isReadOnly) {
        setActionError("Cette version est en lecture seule.");
        return;
      }
      setActionError(null);
      const position = getNextPosition(parentId);
      const lineValues = computeEstimateLineValues(
        {
          quantity: 1,
          unit_price_ht_cents: 0,
          tax_rate_bp: settings.tax_rate_bp,
          k_fo: 1,
          h_mo: 0,
          k_mo: 1,
          pu_ht_cents: 0,
          labor_role_hourly_rate_cents: 0,
        },
        {
          marginMultiplier: settings.margin_multiplier,
          taxRateBp: settings.tax_rate_bp,
        }
      );

      const { data, error } = await supabase
        .from("estimate_items")
        .insert({
          version_id: version.id,
          parent_id: parentId,
          item_type: "line",
          position,
          title: "Nouvelle ligne",
          description: null,
          quantity: 1,
          unit_price_ht_cents: 0,
          tax_rate_bp: settings.tax_rate_bp,
          k_fo: 1,
          h_mo: 0,
          k_mo: 1,
          pu_ht_cents: lineValues.puHtCents,
          labor_role_id: null,
          category_id: null,
          line_total_ht_cents: lineValues.saleLineCents,
          line_tax_cents: lineValues.taxLineCents,
          line_total_ttc_cents: lineValues.ttcLineCents,
        })
        .select("*")
        .single();

      if (error || !data) {
        setActionError(
          resolveEstimateActionError(
            error?.message ?? "Impossible d'ajouter la ligne."
          )
        );
        return;
      }

      setItems((prev) => [...prev, data]);
    },
    [getNextPosition, isReadOnly, settings, supabase, version]
  );

  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      if (isReadOnly) {
        setActionError("Cette version est en lecture seule.");
        return;
      }
      if (!window.confirm("Supprimer cet element et son contenu ?")) return;
      setActionError(null);

      const snapshot = itemsRef.current;
      const idsToRemove = new Set<string>();

      function collect(id: string) {
        idsToRemove.add(id);
        snapshot
          .filter((item) => item.parent_id === id)
          .forEach((child) => collect(child.id));
      }

      collect(itemId);
      setItems((prev) => prev.filter((item) => !idsToRemove.has(item.id)));

      const { error } = await supabase
        .from("estimate_items")
        .delete()
        .eq("id", itemId);

      if (error) {
        setActionError(resolveEstimateActionError(error.message));
        await reloadItems();
      }
    },
    [isReadOnly, reloadItems, supabase]
  );

  const handlePatchItem = useCallback(
    async (
      itemId: string,
      patch: ItemPatch,
      options?: { persist?: boolean }
    ) => {
      if (isReadOnly) {
        setActionError("Cette version est en lecture seule.");
        return;
      }
      const persist = options?.persist ?? false;
      const snapshot = itemsRef.current;
      const current = snapshot.find((item) => item.id === itemId);
      if (!current) return;

      let updated: EstimateItem = { ...current, ...patch };

      if (updated.item_type === "line") {
        const taxRate =
          updated.tax_rate_bp ??
          settings?.tax_rate_bp ??
          current.tax_rate_bp ??
          0;
        const marginMultiplier = settings?.margin_multiplier ?? 1;
        const kFo = updated.k_fo ?? 1;
        const hMo = updated.h_mo ?? 0;
        const kMo = updated.k_mo ?? 1;
        const hourlyRate = updated.labor_role_id
          ? laborRateById.get(updated.labor_role_id) ?? 0
          : 0;
        const lineValues = computeEstimateLineValues(
          {
            ...updated,
            tax_rate_bp: taxRate,
            k_fo: kFo,
            h_mo: hMo,
            k_mo: kMo,
            labor_role_hourly_rate_cents: hourlyRate,
          },
          {
            marginMultiplier,
            taxRateBp: taxRate,
          }
        );
        updated = {
          ...updated,
          tax_rate_bp: taxRate,
          k_fo: kFo,
          h_mo: hMo,
          k_mo: kMo,
          pu_ht_cents: lineValues.puHtCents,
          line_total_ht_cents: lineValues.saleLineCents,
          line_tax_cents: lineValues.taxLineCents,
          line_total_ttc_cents: lineValues.ttcLineCents,
        };
      }

      setItems((prev) =>
        prev.map((item) => (item.id === itemId ? updated : item))
      );

      if (!persist) return;

      const payload: Database["public"]["Tables"]["estimate_items"]["Update"] =
        updated.item_type === "line"
          ? {
              title: updated.title,
              description: updated.description ?? null,
              quantity: updated.quantity,
              unit_price_ht_cents: updated.unit_price_ht_cents,
              tax_rate_bp: updated.tax_rate_bp,
              k_fo: updated.k_fo,
              h_mo: updated.h_mo,
              k_mo: updated.k_mo,
              pu_ht_cents: updated.pu_ht_cents,
              labor_role_id: updated.labor_role_id,
              category_id: updated.category_id,
              line_total_ht_cents: updated.line_total_ht_cents,
              line_tax_cents: updated.line_tax_cents,
              line_total_ttc_cents: updated.line_total_ttc_cents,
            }
          : {
              title: updated.title,
            };

      const { error } = await supabase
        .from("estimate_items")
        .update(payload)
        .eq("id", itemId);

      if (error) {
        setActionError(resolveEstimateActionError(error.message));
        setItems(snapshot);
      }
    },
    [
      isReadOnly,
      laborRateById,
      settings?.margin_multiplier,
      settings?.tax_rate_bp,
      supabase,
    ]
  );

  const handleReorder = useCallback(
    async (parentId: string | null, orderedIds: string[]) => {
      if (isReadOnly) {
        setActionError("Cette version est en lecture seule.");
        return;
      }
      const snapshot = itemsRef.current;
      const updated = snapshot.map((item) => {
        if (item.parent_id !== parentId) return item;
        const index = orderedIds.indexOf(item.id);
        if (index === -1) return item;
        return { ...item, position: index + 1 };
      });

      setItems(updated);

      const updates = await Promise.all(
        updated
          .filter((item) => item.parent_id === parentId)
          .map((item) =>
            supabase
              .from("estimate_items")
              .update({ position: item.position })
              .eq("id", item.id)
          )
      );

      const hasError = updates.some((result) => result.error);
      if (hasError) {
        setActionError("Impossible de reordonner les lignes.");
        setItems(snapshot);
      }
    },
    [isReadOnly, supabase]
  );

  async function handleStatusChange(nextStatus: EstimateStatus) {
    if (!version || isUpdatingStatus) return;
    setStatusError(null);
    setIsUpdatingStatus(true);

    const { error } = await supabase
      .from("estimate_versions")
      .update({ status: nextStatus })
      .eq("id", version.id);

    setIsUpdatingStatus(false);

    if (error) {
      setStatusError(resolveEstimateActionError(error.message));
      return;
    }

    setVersion((prev) => (prev ? { ...prev, status: nextStatus } : prev));
  }

  if (!versionId) {
    return (
      <div className="animate-fade-in">
        <div className="alert alert-error">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          Version introuvable.
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="animate-fade-in flex min-h-[300px] items-center justify-center">
        <div className="flex items-center gap-3 text-[var(--slate-500)]">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]"></div>
          Chargement du chiffrage...
        </div>
      </div>
    );
  }

  if (loadError || !version || !settings) {
    return (
      <div className="animate-fade-in">
        <div className="alert alert-error mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {loadError ?? "Impossible de charger le chiffrage."}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Editer le chiffrage</h1>
          <p className="page-description">
            Version{" "}
            <span className="font-mono text-[var(--slate-600)]">
              {versionId}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={estimateStatusClass(version.status)}>
            {estimateStatusLabel(version.status)}
          </span>
          {canSend ? (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => handleStatusChange("sent")}
              disabled={isUpdatingStatus}
            >
              Envoyer
            </button>
          ) : null}
          {canAccept ? (
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => handleStatusChange("accepted")}
              disabled={isUpdatingStatus}
            >
              Accepter
            </button>
          ) : null}
          {canArchive ? (
            <button
              className="btn btn-danger btn-sm"
              type="button"
              onClick={() => handleStatusChange("archived")}
              disabled={isUpdatingStatus}
            >
              Archiver
            </button>
          ) : null}
          <Link
            className="btn btn-secondary btn-sm"
            href={`/dashboard/estimates/${versionId ?? ""}`}
          >
            Retour
          </Link>
        </div>
      </div>

      {statusError && (
        <div className="alert alert-error mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {statusError}
        </div>
      )}

      {isReadOnly && (
        <div className="alert alert-info mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
          Cette version est en lecture seule car son statut n&apos;est plus brouillon.
        </div>
      )}

      <div className="estimate-tabs mt-6">
        <button
          className={`estimate-tab ${
            activeTab === "settings" ? "estimate-tab--active" : ""
          }`}
          type="button"
          onClick={() => setActiveTab("settings")}
        >
          Parametrage
        </button>
        <button
          className={`estimate-tab ${
            activeTab === "editor" ? "estimate-tab--active" : ""
          }`}
          type="button"
          onClick={() => setActiveTab("editor")}
        >
          Editeur
        </button>
      </div>

      {activeTab === "settings" ? (
        <div className="space-y-6 mt-6">
          {actionError && (
            <div className="alert alert-error">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="m15 9-6 6" />
                <path d="m9 9 6 6" />
              </svg>
              {actionError}
            </div>
          )}
          <EstimateSettingsPanel
            projectName={projectName}
            versionNumber={version.version_number}
            settings={settings}
            totals={totals}
            isSaving={isSavingSettings}
            isReadOnly={isReadOnly}
            error={null}
            onChange={updateSettings}
            onSave={handleSaveSettings}
          />
          <LaborRolesManager
            roles={laborRoles}
            isSaving={isSavingSettings}
            error={null}
            onCreate={handleCreateRole}
            onUpdate={handleUpdateRole}
          />
        </div>
      ) : (
        <div className="mt-6">
          <EstimateEditorTable
            items={items}
            categories={categories}
            laborRoles={laborRoles}
            actionError={actionError}
            isReadOnly={isReadOnly}
            onAddSection={handleAddSection}
            onAddLine={handleAddLine}
            onDeleteItem={handleDeleteItem}
            onPatchItem={handlePatchItem}
            onReorder={handleReorder}
            onEnsureCategory={handleEnsureCategory}
          />
        </div>
      )}
    </div>
  );
}
