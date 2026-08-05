import { readFileSync, writeFileSync } from "fs";

const en = JSON.parse(readFileSync("messages/en.json", "utf8"));

// Replace dashboard sections
en.admin.dashboard.sections = {
  kpi: "Business Health",
  actions: "Requires Attention",
  monitoring: "Monitoring",
  modules: "Modules"
};
delete en.admin.dashboard.otherGroup;
delete en.admin.dashboard.groups;

// 12 new cards
en.admin.dashboard.cards = {
  businessHealth: {
    title: "Business Health",
    description: "Revenue, margin, active clients — last 30 days"
  },
  reviewServices: {
    title: "Review Services",
    description: "Today's services with checklist progress"
  },
  reviewQuotes: {
    title: "Review Quotes",
    description: "Quotes below the 15% margin floor"
  },
  reviewUpsells: {
    title: "Review Upsells",
    description: "Upsells proposed by the team"
  },
  approveServices: {
    title: "Approve Services",
    description: "Completed services with photo evidence"
  },
  reviewAlerts: {
    title: "Review Alerts",
    description: "Unified queue — respond in 10 min vs. can wait"
  },
  todaysDispatch: {
    title: "Today's Dispatch",
    description: "Daily assignment matrix"
  },
  atRiskClients: {
    title: "At-Risk Clients",
    description: "Churn signals, low NPS, late payments"
  },
  netMargin: {
    title: "Net Margin",
    description: "Revenue − variable costs − fixed costs — this month"
  },
  teamScore: {
    title: "Team Score",
    description: "Weekly top 3 and individual averages"
  },
  craDeadlines: {
    title: "CRA Deadlines",
    description: "Upcoming CPP/EI, GST/PST, T4 payments"
  },
  backupStatus: {
    title: "Backup Status",
    description: "Latest transactions/payroll/clients/photos backup"
  }
};

// 5 module groups
en.admin.modules = {
  people: {
    title: "People",
    items: {
      employees: "Employees",
      applicants: "Applicants",
      teams: "Teams",
      teamRotation: "Team Rotation",
      certifications: "Certifications",
      wellbeing: "Wellbeing",
      marketing: "Team Marketing"
    }
  },
  clients: {
    title: "Clients",
    items: {
      newClients: "New Clients",
      segments: "Segments",
      candidatePool: "Candidate Pool",
      campaigns: "Campaigns",
      gifts: "Gifts",
      neighborhood: "Neighborhood"
    }
  },
  finance: {
    title: "Finance",
    items: {
      contributionMargin: "Contribution Margin",
      pricingRules: "Pricing Rules",
      pricingSettings: "Pricing Settings",
      payrollExport: "Payroll Export",
      insurance: "Insurance",
      economicSettings: "Economic Settings",
      partners: "Partners",
      paymentSuccess: "Payment Success"
    }
  },
  compliance: {
    title: "Compliance",
    items: {
      laborCompliance: "Labor Compliance",
      privacy: "Privacy",
      contractRenewals: "Contract Renewals",
      legalUpdates: "Legal Updates",
      incidents: "Incidents"
    }
  },
  system: {
    title: "System",
    items: {
      recoveryDrills: "Recovery Drills",
      stressTest: "Stress Test",
      migrationClosure: "Migration Closure",
      experiments: "Experiments",
      localSeo: "Local SEO",
      growthMetrics: "Growth Metrics",
      attribution: "Attribution"
    }
  }
};

writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n");
console.log("OK");
