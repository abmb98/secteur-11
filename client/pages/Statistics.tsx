import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useFirestore } from '@/hooks/useFirestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { AdvancedNavigation } from '@/components/AdvancedNavigation';
import { ResponsiveDataTable } from '@/components/ResponsiveDataTable';
import { AdvancedSearch } from '@/components/AdvancedSearch';
import { SimpleLayout } from '@/components/SimpleLayout';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  BarChart3,
  Users,
  BedDouble,
  Building2,
  TrendingUp,
  TrendingDown,
  Calendar,
  Download,
  Filter,
  Clock,
  LogOut,
  MapPin,
  AlertTriangle,
  CheckCircle,
  Activity,
  Target,
  UserCheck,
  UserX,
  Home,
  Zap,
  ArrowUp,
  ArrowDown,
  Minus,
  PieChart,
  BarChart,
  LineChart,
  Users2,
  Clock3,
  TrendingDown as TrendDown,
  Eye,
  Sparkles
} from 'lucide-react';
import { Ferme, Worker, Room } from '@shared/types';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

// Extend jsPDF type to include autoTable
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => void;
    lastAutoTable: { finalY: number };
  }
}
import { NetworkErrorHandler } from '@/components/NetworkErrorHandler';
import { forceSyncRoomOccupancy, getOccupancySummary, type SyncResult } from '@/utils/syncUtils';

export default function Statistics() {
  const navigate = useNavigate();
  const { user, isSuperAdmin } = useAuth();
  const { data: fermes, error: fermesError, refetch: refetchFermes } = useFirestore<Ferme>('fermes');
  const { data: allWorkers, error: workersError, refetch: refetchWorkers } = useFirestore<Worker>('workers');
  const { data: allRooms, error: roomsError, refetch: refetchRooms } = useFirestore<Room>('rooms');
  
  const [selectedFerme, setSelectedFerme] = useState('all');
  const [timeRange, setTimeRange] = useState('month');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  // Helper function to get month name
  const getMonthName = (monthNum: string) => {
    const months = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 
                   'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
    return months[parseInt(monthNum)];
  };

  // Filter data based on user role and selected ferme
  const workers = selectedFerme === 'all' 
    ? (isSuperAdmin ? allWorkers : allWorkers.filter(w => w.fermeId === user?.fermeId))
    : allWorkers.filter(w => w.fermeId === selectedFerme);
  
  const rooms = selectedFerme === 'all'
    ? (isSuperAdmin ? allRooms : allRooms.filter(r => r.fermeId === user?.fermeId))
    : allRooms.filter(r => r.fermeId === selectedFerme);

  // Comprehensive statistics calculation
  const statistics = useMemo(() => {
    // Enhanced filtering for specific month/year
    const filterByTimeRange = (date: Date, range: string) => {
      if (range === 'specific_month' && selectedMonth && selectedYear) {
        return date.getMonth() + 1 == parseInt(selectedMonth) &&
               date.getFullYear() == parseInt(selectedYear);
      }
      if (range === 'specific_year' && selectedYear) {
        return date.getFullYear() == parseInt(selectedYear);
      }
      // For relative periods (week, month, quarter, year), use threshold comparison
      const getTimeThreshold = (range: string) => {
        const date = new Date();
        switch (range) {
          case 'week': date.setDate(date.getDate() - 7); break;
          case 'month': date.setDate(date.getDate() - 30); break;
          case 'quarter': date.setDate(date.getDate() - 90); break;
          case 'year': date.setFullYear(date.getFullYear() - 1); break;
          default: date.setDate(date.getDate() - 30);
        }
        return date;
      };
      const threshold = getTimeThreshold(range);
      return date >= threshold;
    };

    // Filter workers based on the time period for entry dates
    const getFilteredWorkers = () => {
      if (timeRange === 'specific_month' || timeRange === 'specific_year') {
        // For specific month/year, filter workers by their entry date
        return workers.filter(w => {
          if (!w.dateEntree) return false;
          return filterByTimeRange(new Date(w.dateEntree), timeRange);
        });
      }
      // For other time ranges, use all workers (existing behavior)
      return workers;
    };

    const filteredWorkers = getFilteredWorkers();
    const activeWorkers = filteredWorkers.filter(w => w.statut === 'actif');
    const inactiveWorkers = filteredWorkers.filter(w => w.statut === 'inactif');
    const exitedWorkers = filteredWorkers.filter(w => w.statut === 'inactif' && w.dateSortie);
    
    const maleWorkers = activeWorkers.filter(w => w.sexe === 'homme');
    const femaleWorkers = activeWorkers.filter(w => w.sexe === 'femme');
    
    const maleRooms = rooms.filter(r => r.genre === 'hommes');
    const femaleRooms = rooms.filter(r => r.genre === 'femmes');
    
    const occupiedRooms = rooms.filter(r => r.occupantsActuels > 0);
    const fullRooms = rooms.filter(r => r.occupantsActuels >= r.capaciteTotale);
    const emptyRooms = rooms.filter(r => r.occupantsActuels === 0);
    
    const totalCapacity = rooms.reduce((sum, room) => sum + room.capaciteTotale, 0);

    // Calculate actual occupied places from worker assignments (gender-aware)
    const occupiedPlaces = (() => {
      const workerRoomMap = new Map<string, number>();

      workers.filter(w => w.statut === 'actif' && w.chambre).forEach(worker => {
        const workerGenderType = worker.sexe === 'homme' ? 'hommes' : 'femmes';
        const roomKey = `${worker.fermeId}-${worker.chambre}-${workerGenderType}`;
        workerRoomMap.set(roomKey, (workerRoomMap.get(roomKey) || 0) + 1);
      });

      return Array.from(workerRoomMap.values()).reduce((sum, count) => sum + count, 0);
    })();

    const availablePlaces = totalCapacity - occupiedPlaces;
    
    const occupancyRate = totalCapacity > 0 ? (occupiedPlaces / totalCapacity) * 100 : 0;

    // For recent arrivals/exits, use the original workers array with time filtering
    const recentArrivals = workers.filter(w =>
      filterByTimeRange(new Date(w.dateEntree), timeRange) && w.statut === 'actif'
    );
    const recentExits = workers.filter(w => w.statut === 'inactif' && w.dateSortie).filter(w =>
      w.dateSortie && filterByTimeRange(new Date(w.dateSortie), timeRange)
    );

    // Exit analysis - use filtered exits for specific periods
    const exitReasonsData = (timeRange === 'specific_month' || timeRange === 'specific_year') ? recentExits : exitedWorkers;
    const exitReasons = exitReasonsData.reduce((acc, worker) => {
      const reason = worker.motif || 'Non spécifié';
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topExitReason = Object.entries(exitReasons)
      .sort(([,a], [,b]) => b - a)[0];

    // Length of stay analysis - use filtered data for specific periods
    const staysWithDuration = exitReasonsData
      .filter(w => w.dateEntree && w.dateSortie)
      .map(w => {
        const entryDate = new Date(w.dateEntree);
        const exitDate = new Date(w.dateSortie!);
        return Math.floor((exitDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));
      });

    const averageStayDuration = staysWithDuration.length > 0
      ? Math.round(staysWithDuration.reduce((sum, days) => sum + days, 0) / staysWithDuration.length)
      : 0;

    // Age analysis
    const ages = activeWorkers.map(w => w.age);
    const averageAge = ages.length > 0 ? Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length) : 0;
    const minAge = ages.length > 0 ? Math.min(...ages) : 0;
    const maxAge = ages.length > 0 ? Math.max(...ages) : 0;

    const ageDistribution = {
      '18-25': activeWorkers.filter(w => w.age >= 18 && w.age <= 25).length,
      '26-35': activeWorkers.filter(w => w.age >= 26 && w.age <= 35).length,
      '36-45': activeWorkers.filter(w => w.age >= 36 && w.age <= 45).length,
      '46+': activeWorkers.filter(w => w.age >= 46).length
    };

    // Efficiency metrics (calculated in return statement)
    
    // Performance indicators
    const isHighOccupancy = occupancyRate > 85;
    const isLowOccupancy = occupancyRate < 50;
    const hasRecentGrowth = recentArrivals.length > recentExits.length;
    const balancedGender = Math.abs(maleWorkers.length - femaleWorkers.length) <= Math.ceil(activeWorkers.length * 0.2);

    return {
      // Basic counts
      totalWorkers: activeWorkers.length,
      totalInactiveWorkers: inactiveWorkers.length,
      maleWorkers: maleWorkers.length,
      femaleWorkers: femaleWorkers.length,
      totalRooms: rooms.length,
      maleRooms: maleRooms.length,
      femaleRooms: femaleRooms.length,
      occupiedRooms: occupiedRooms.length,
      emptyRooms: emptyRooms.length,
      fullRooms: fullRooms.length,
      
      // Capacity metrics
      totalCapacity,
      occupiedPlaces,
      availablePlaces,
      occupancyRate: Math.round(occupancyRate * 100) / 100,
      
      // Time-based metrics
      recentArrivals: recentArrivals.length,
      recentExits: recentExits.length,
      netChange: recentArrivals.length - recentExits.length,
      
      // Age metrics
      averageAge,
      minAge,
      maxAge,
      ageDistribution,
      
      // Stay duration
      averageStayDuration,
      totalExitedWorkers: exitReasonsData.length,
      
      // Exit analysis
      exitReasons,
      topExitReason: topExitReason ? topExitReason[0] : 'Aucune',
      topExitReasonCount: topExitReason ? topExitReason[1] : 0,
      
      // Performance metrics - adjusted for filtered data
      turnoverRate: Math.round((filteredWorkers.length > 0 ? (exitReasonsData.length / filteredWorkers.length) * 100 : 0) * 100) / 100,
      retentionRate: Math.round((100 - (filteredWorkers.length > 0 ? (exitReasonsData.length / filteredWorkers.length) * 100 : 0)) * 100) / 100,
      utilizationRate: Math.round(occupancyRate * 100) / 100,
      
      // Status indicators
      isHighOccupancy,
      isLowOccupancy,
      hasRecentGrowth,
      balancedGender,
      
      // Trends (mock data - in real app would calculate from historical data)
      occupancyTrend: hasRecentGrowth ? 8.5 : -3.2,
      workersTrend: recentArrivals.length > 0 ? 12.1 : -5.4,
    };
  }, [workers, rooms, timeRange, selectedMonth, selectedYear]);

  // PDF Export functionality
  const generatePDFReport = (fermeId: string | 'all' = 'all') => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const margin = 20;
    let yPosition = margin;

    // Filter data based on ferme
    const reportFermes = fermeId === 'all' ? fermes : fermes.filter(f => f.id === fermeId);
    const reportTitle = fermeId === 'all' ? 'Rapport Statistique Complet' : `Rapport Statistique - ${reportFermes[0]?.nom || 'Ferme'}`;

    // Header
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text(reportTitle, pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 15;

    // Date and filters
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const currentDate = new Date().toLocaleDateString('fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    doc.text(`Généré le ${currentDate}`, pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 10;

    if (timeRange !== 'month' || selectedMonth || selectedYear) {
      let filterText = 'Période: ';
      if (timeRange === 'specific_month' && selectedMonth && selectedYear) {
        filterText += `${getMonthName(selectedMonth)} ${selectedYear}`;
      } else if (timeRange === 'specific_year' && selectedYear) {
        filterText += selectedYear;
      } else {
        filterText += {
          'week': '7 derniers jours',
          'month': '30 derniers jours',
          'quarter': '3 derniers mois',
          'year': 'Dernière année'
        }[timeRange] || '30 derniers jours';
      }
      doc.text(filterText, pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 15;
    } else {
      yPosition += 10;
    }

    // Executive Summary
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Résumé Ex��cutif', margin, yPosition);
    yPosition += 10;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const summaryText = [
      `• ${statistics.totalWorkers} ouvriers actifs dans le système`,
      `• Taux d'occupation: ${statistics.occupancyRate}% (${statistics.occupiedPlaces}/${statistics.totalCapacity} places)`,
      `• ${statistics.availablePlaces} places disponibles`,
      `• Âge moyen des ouvriers: ${statistics.averageAge} ans`,
      `• Taux de rétention: ${statistics.retentionRate}%`,
      `• ${statistics.recentArrivals} nouveaux arrivants et ${statistics.recentExits} sorties`,
      `• Motif de sortie principal: ${statistics.topExitReason} (${statistics.topExitReasonCount} cas)`
    ];

    summaryText.forEach(text => {
      doc.text(text, margin, yPosition);
      yPosition += 6;
    });
    yPosition += 10;

    // KPI Table
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Indicateurs Clés de Performance', margin, yPosition);
    yPosition += 10;

    const kpiData = [
      ['Indicateur', 'Valeur', 'Statut'],
      ['Ouvriers Actifs', statistics.totalWorkers.toString(), statistics.totalWorkers > 0 ? 'Actif' : 'Inactif'],
      ['Taux d\'Occupation', `${statistics.occupancyRate}%`, statistics.isHighOccupancy ? 'Élevé' : statistics.isLowOccupancy ? 'Faible' : 'Optimal'],
      ['Nouveaux Arrivants', statistics.recentArrivals.toString(), statistics.hasRecentGrowth ? 'Croissance' : 'Stable'],
      ['Sorties', statistics.recentExits.toString(), statistics.recentExits > statistics.recentArrivals ? 'Élevé' : 'Normal'],
      ['Taux de Rétention', `${statistics.retentionRate}%`, statistics.retentionRate > 85 ? 'Excellent' : statistics.retentionRate > 70 ? 'Bon' : 'À améliorer'],
      ['Durée Moyenne de Séjour', `${statistics.averageStayDuration} jours`, statistics.averageStayDuration > 30 ? 'Long' : 'Court']
    ];

    (doc as any).autoTable({
      startY: yPosition,
      head: [kpiData[0]],
      body: kpiData.slice(1),
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246], textColor: 255 },
      styles: { fontSize: 9 },
      margin: { left: margin, right: margin }
    });

    yPosition = (doc as any).lastAutoTable.finalY + 15;

    // Demographics Section
    if (yPosition > pageHeight - 80) {
      doc.addPage();
      yPosition = margin;
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Démographie', margin, yPosition);
    yPosition += 10;

    // Gender Distribution
    const genderData = [
      ['Genre', 'Nombre', 'Pourcentage'],
      ['Hommes', statistics.maleWorkers.toString(), `${statistics.totalWorkers > 0 ? Math.round((statistics.maleWorkers / statistics.totalWorkers) * 100) : 0}%`],
      ['Femmes', statistics.femaleWorkers.toString(), `${statistics.totalWorkers > 0 ? Math.round((statistics.femaleWorkers / statistics.totalWorkers) * 100) : 0}%`]
    ];

    (doc as any).autoTable({
      startY: yPosition,
      head: [genderData[0]],
      body: genderData.slice(1),
      theme: 'grid',
      headStyles: { fillColor: [139, 69, 19], textColor: 255 },
      styles: { fontSize: 9 },
      margin: { left: margin, right: margin },
      columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 40 }, 2: { cellWidth: 40 } }
    });

    yPosition = (doc as any).lastAutoTable.finalY + 10;

    // Age Distribution
    const ageData = [
      ['Tranche d\'âge', 'Nombre', 'Pourcentage'],
      ...Object.entries(statistics.ageDistribution).map(([range, count]) => [
        `${range} ans`,
        count.toString(),
        `${statistics.totalWorkers > 0 ? Math.round((count / statistics.totalWorkers) * 100) : 0}%`
      ])
    ];

    (doc as any).autoTable({
      startY: yPosition,
      head: [ageData[0]],
      body: ageData.slice(1),
      theme: 'grid',
      headStyles: { fillColor: [139, 69, 19], textColor: 255 },
      styles: { fontSize: 9 },
      margin: { left: margin, right: margin },
      columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 40 }, 2: { cellWidth: 40 } }
    });

    yPosition = (doc as any).lastAutoTable.finalY + 15;

    // Occupancy Analysis
    if (yPosition > pageHeight - 80) {
      doc.addPage();
      yPosition = margin;
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Analyse d\'Occupation', margin, yPosition);
    yPosition += 10;

    const occupancyData = [
      ['Métrique', 'Valeur'],
      ['Chambres Totales', statistics.totalRooms.toString()],
      ['Chambres Occupées', statistics.occupiedRooms.toString()],
      ['Chambres Vides', statistics.emptyRooms.toString()],
      ['Chambres Pleines', statistics.fullRooms.toString()],
      ['Capacité Totale', statistics.totalCapacity.toString()],
      ['Places Occupées', statistics.occupiedPlaces.toString()],
      ['Places Disponibles', statistics.availablePlaces.toString()],
      ['Taux d\'Utilisation', `${statistics.utilizationRate}%`]
    ];

    (doc as any).autoTable({
      startY: yPosition,
      head: [occupancyData[0]],
      body: occupancyData.slice(1),
      theme: 'striped',
      headStyles: { fillColor: [34, 197, 94], textColor: 255 },
      styles: { fontSize: 9 },
      margin: { left: margin, right: margin }
    });

    yPosition = (doc as any).lastAutoTable.finalY + 15;

    // Exit Analysis
    if (yPosition > pageHeight - 80) {
      doc.addPage();
      yPosition = margin;
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Analyse des Sorties', margin, yPosition);
    yPosition += 10;

    const exitData = [
      ['Motif de Sortie', 'Nombre', 'Pourcentage'],
      ...Object.entries(statistics.exitReasons)
        .sort(([,a], [,b]) => b - a)
        .map(([reason, count]) => [
          reason.charAt(0).toUpperCase() + reason.slice(1).replace('_', ' '),
          count.toString(),
          `${statistics.totalExitedWorkers > 0 ? Math.round((count / statistics.totalExitedWorkers) * 100) : 0}%`
        ])
    ];

    if (exitData.length > 1) {
      (doc as any).autoTable({
        startY: yPosition,
        head: [exitData[0]],
        body: exitData.slice(1),
        theme: 'grid',
        headStyles: { fillColor: [239, 68, 68], textColor: 255 },
        styles: { fontSize: 9 },
        margin: { left: margin, right: margin }
      });
    } else {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'italic');
      doc.text('Aucune sortie enregistrée pour la période sélectionnée.', margin, yPosition);
    }

    // Performance Metrics
    if (fermeId === 'all') {
      doc.addPage();
      yPosition = margin;

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('Métriques de Performance par Ferme', margin, yPosition);
      yPosition += 10;

      const fermeMetrics = reportFermes.map(ferme => {
        const fermeWorkers = allWorkers.filter(w => w.fermeId === ferme.id && w.statut === 'actif');
        const fermeRooms = allRooms.filter(r => r.fermeId === ferme.id);
        const totalCapacity = fermeRooms.reduce((sum, room) => sum + room.capaciteTotale, 0);
        const occupiedPlaces = fermeRooms.reduce((sum, room) => sum + room.occupantsActuels, 0);
        const occupancyRate = totalCapacity > 0 ? Math.round((occupiedPlaces / totalCapacity) * 100) : 0;

        return [
          ferme.nom,
          fermeWorkers.length.toString(),
          fermeRooms.length.toString(),
          `${occupancyRate}%`,
          (totalCapacity - occupiedPlaces).toString()
        ];
      });

      const fermeData = [
        ['Ferme', 'Ouvriers', 'Chambres', 'Occupation', 'Places Libres'],
        ...fermeMetrics
      ];

      (doc as any).autoTable({
        startY: yPosition,
        head: [fermeData[0]],
        body: fermeData.slice(1),
        theme: 'striped',
        headStyles: { fillColor: [168, 85, 247], textColor: 255 },
        styles: { fontSize: 9 },
        margin: { left: margin, right: margin }
      });
    }

    // Footer
    const totalPages = doc.internal.pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(`Page ${i} sur ${totalPages}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
      doc.text('Rapport généré par le Système de Gestion des Ouvriers', margin, pageHeight - 10);
    }

    return doc;
  };

  // Handle export options
  const handleExport = () => {
    if (isSuperAdmin) {
      // Show export options for super admin
      setShowExportOptions(true);
    } else {
      // Generate PDF for current ferme only
      const doc = generatePDFReport(user?.fermeId || 'all');
      const fileName = `rapport_statistiques_${user?.fermeId || 'ferme'}_${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
    }
  };

  const [showExportOptions, setShowExportOptions] = useState(false);

  const handleComprehensiveExport = () => {
    const doc = generatePDFReport('all');
    const fileName = `rapport_statistiques_complet_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);
    setShowExportOptions(false);
  };

  const handleFermeExport = (fermeId: string) => {
    const doc = generatePDFReport(fermeId);
    const fermeName = fermes.find(f => f.id === fermeId)?.nom || 'ferme';
    const fileName = `rapport_statistiques_${fermeName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);
    setShowExportOptions(false);
  };

  // Utility function for trend display
  const TrendIndicator = ({ value, isPositive }: { value: number; isPositive: boolean }) => (
    <div className={`inline-flex items-center space-x-1 text-xs px-2 py-1 rounded-full ${
      isPositive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
    }`}>
      {isPositive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      <span>{Math.abs(value).toFixed(1)}%</span>
    </div>
  );

  // Modern Metric Card Component
  const MetricCard = ({ 
    title, 
    value, 
    subtitle, 
    icon: Icon, 
    trend,
    className = ""
  }: {
    title: string;
    value: string | number;
    subtitle: string;
    icon: React.ElementType;
    trend?: { value: number; isPositive: boolean };
    className?: string;
  }) => (
    <Card className={`relative overflow-hidden border-0 bg-white shadow-sm hover:shadow-md transition-all duration-300 ${className}`}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gradient-to-br from-slate-100 to-slate-200 rounded-lg">
              <Icon className="h-5 w-5 text-slate-700" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-600">{title}</p>
              <p className="text-2xl font-bold text-slate-900">{value}</p>
            </div>
          </div>
          {trend && <TrendIndicator value={trend.value} isPositive={trend.isPositive} />}
        </div>
        <p className="text-xs text-slate-500 mt-2">{subtitle}</p>
      </CardContent>
    </Card>
  );

  // Main KPI Card with better visual hierarchy
  const KPICard = ({
    title,
    value,
    subtitle,
    icon: Icon,
    color,
    trend,
    onClick
  }: {
    title: string;
    value: string | number;
    subtitle: string;
    icon: React.ElementType;
    color: string;
    trend?: { value: number; isPositive: boolean };
    onClick?: () => void;
  }) => {
    const colorClasses = {
      blue: 'bg-gradient-to-br from-blue-500 to-indigo-600',
      emerald: 'bg-gradient-to-br from-emerald-500 to-teal-600',
      purple: 'bg-gradient-to-br from-purple-500 to-violet-600',
      amber: 'bg-gradient-to-br from-amber-500 to-orange-600',
      rose: 'bg-gradient-to-br from-rose-500 to-pink-600',
      cyan: 'bg-gradient-to-br from-cyan-500 to-blue-600'
    };

    return (
      <Card
        className={`relative overflow-hidden border-0 ${colorClasses[color as keyof typeof colorClasses] || colorClasses.blue} text-white shadow-lg hover:shadow-xl transition-all duration-300 ${onClick ? 'cursor-pointer hover:scale-105' : ''}`}
        onClick={onClick}
      >
        <CardContent className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="p-3 bg-white/20 backdrop-blur-sm rounded-xl">
              <Icon className="h-6 w-6" />
            </div>
            {trend && (
              <div className={`flex items-center space-x-1 text-xs px-2 py-1 rounded-full ${
                trend.isPositive ? 'bg-white/20 text-white' : 'bg-white/20 text-white'
              }`}>
                {trend.isPositive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                <span>{Math.abs(trend.value).toFixed(1)}%</span>
              </div>
            )}
          </div>
          
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-white/80 uppercase tracking-wider">{title}</h3>
            <p className="text-3xl font-bold">{value}</p>
            <p className="text-sm text-white/70">{subtitle}</p>
          </div>
        </CardContent>
      </Card>
    );
  };

  // Check for network errors
  const networkError = fermesError || workersError || roomsError;
  const hasNetworkError = networkError && (
    networkError.includes('fetch') ||
    networkError.includes('Failed to fetch') ||
    networkError.includes('TypeError') ||
    networkError.includes('Erreur de réseau') ||
    networkError.includes('network') ||
    networkError.includes('connexion') ||
    networkError.includes('🌐')
  );

  const handleRetry = () => {
    console.log('🔄 User initiated retry - attempting to reconnect to Firebase...');
    console.log('Current errors:', { fermesError, workersError, roomsError });
    refetchFermes();
    refetchWorkers();
    refetchRooms();
  };

  const handleSyncRoomOccupancy = async () => {
    setSyncLoading(true);
    setSyncResult(null);

    try {
      const result = await forceSyncRoomOccupancy(allWorkers, allRooms);
      setSyncResult(result);

      // Refresh data after sync
      refetchWorkers();
      refetchRooms();

      console.log('🎯 Sync completed, refreshing data...');
    } catch (error) {
      console.error('❌ Sync failed:', error);
    } finally {
      setSyncLoading(false);
    }
  };

  // Get occupancy summary for debugging
  const occupancySummary = getOccupancySummary(allWorkers, allRooms);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {hasNetworkError && (
        <div className="px-4 sm:px-6 lg:px-8 py-8">
          <NetworkErrorHandler
            error={networkError}
            onRetry={handleRetry}
          />
        </div>
      )}
      
      {/* Page Header */}
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col space-y-4 lg:space-y-0 lg:flex-row lg:justify-between lg:items-center">
          <div className="flex items-center space-x-4">
            <div className="p-3 bg-slate-800 rounded-lg">
              <BarChart3 className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl lg:text-3xl font-semibold text-slate-900 tracking-tight">
                Statistiques
              </h1>
              <p className="text-slate-600 mt-1">Insights et métriques en temps réel</p>
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              onClick={handleSyncRoomOccupancy}
              disabled={syncLoading}
              variant="outline"
              className="border-slate-200 hover:bg-slate-50"
            >
              <Activity className="mr-2 h-4 w-4" />
              {syncLoading ? 'Sync...' : 'Sync Data'}
            </Button>
            <Button
              onClick={handleExport}
              className="bg-slate-800 hover:bg-slate-900"
            >
              <Download className="mr-2 h-4 w-4" />
              Exporter
            </Button>
          </div>
        </div>
      </div>

      <div className="px-3 sm:px-4 lg:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* Smart Filters Section */}
        <Card className="border-0 shadow-sm bg-white/80 backdrop-blur-sm">
          <CardContent className="p-3 sm:p-4">
            <div className="space-y-3 sm:space-y-4">

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 overflow-x-auto">
                {isSuperAdmin && (
                  <div className="flex items-center space-x-2 flex-shrink-0 w-full sm:w-auto">
                    <Building2 className="h-4 w-4 text-slate-600" />
                    <Select value={selectedFerme} onValueChange={setSelectedFerme}>
                      <SelectTrigger className="border-slate-200 hover:border-slate-400 focus:border-indigo-500 bg-white text-sm w-full sm:w-auto sm:min-w-[120px] flex-row">
                        <SelectValue placeholder="Ferme" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Toutes les fermes</SelectItem>
                        {fermes.map(ferme => (
                          <SelectItem key={ferme.id} value={ferme.id}>
                            {ferme.nom}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex items-center space-x-2 flex-shrink-0 w-full sm:w-auto">
                  <Calendar className="h-4 w-4 text-slate-600" />
                  <Select value={timeRange} onValueChange={setTimeRange}>
                    <SelectTrigger className="border-slate-200 hover:border-slate-400 focus:border-indigo-500 bg-white text-sm w-full sm:w-auto sm:min-w-[100px] flex-row">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="week">7 jours</SelectItem>
                      <SelectItem value="month">30 jours</SelectItem>
                      <SelectItem value="quarter">3 mois</SelectItem>
                      <SelectItem value="year">1 an</SelectItem>
                      <SelectItem value="specific_month">Mois spécifique</SelectItem>
                      <SelectItem value="specific_year">Année spécifique</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Specific Month Selection */}
                {timeRange === 'specific_month' && (
                  <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                    <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                      <SelectTrigger className="border-slate-200 hover:border-slate-400 focus:border-indigo-500 bg-white text-sm w-full sm:w-auto sm:min-w-[90px] flex-row flex-shrink-0">
                        <SelectValue placeholder="Mois" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Janvier</SelectItem>
                        <SelectItem value="2">Février</SelectItem>
                        <SelectItem value="3">Mars</SelectItem>
                        <SelectItem value="4">Avril</SelectItem>
                        <SelectItem value="5">Mai</SelectItem>
                        <SelectItem value="6">Juin</SelectItem>
                        <SelectItem value="7">Juillet</SelectItem>
                        <SelectItem value="8">Août</SelectItem>
                        <SelectItem value="9">Septembre</SelectItem>
                        <SelectItem value="10">Octobre</SelectItem>
                        <SelectItem value="11">Novembre</SelectItem>
                        <SelectItem value="12">Décembre</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={selectedYear} onValueChange={setSelectedYear}>
                      <SelectTrigger className="border-slate-200 hover:border-slate-400 focus:border-indigo-500 bg-white text-sm w-full sm:w-auto sm:min-w-[75px] flex-row flex-shrink-0">
                        <SelectValue placeholder="Année" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 10 }, (_, i) => {
                          const year = new Date().getFullYear() - i;
                          return (
                            <SelectItem key={year} value={year.toString()}>
                              {year}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Specific Year Selection */}
                {timeRange === 'specific_year' && (
                  <Select value={selectedYear} onValueChange={setSelectedYear}>
                    <SelectTrigger className="border-slate-200 hover:border-slate-400 focus:border-indigo-500 bg-white text-sm w-full sm:w-auto sm:min-w-[75px] flex-row flex-shrink-0">
                      <SelectValue placeholder="Année" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 10 }, (_, i) => {
                        const year = new Date().getFullYear() - i;
                        return (
                          <SelectItem key={year} value={year.toString()}>
                            {year}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Active filters display */}
              {(selectedFerme !== 'all' || timeRange !== 'month' || selectedMonth || selectedYear) && (
                <div className="flex flex-wrap items-center gap-1.5 pt-2 sm:pt-0">
                  {selectedFerme !== 'all' && (
                    <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-xs px-2 py-1">
                      <Building2 className="w-3 h-3 mr-1" />
                      <span className="truncate max-w-[100px] sm:max-w-[120px]">
                        {fermes.find(f => f.id === selectedFerme)?.nom || selectedFerme}
                      </span>
                    </Badge>
                  )}
                  {(timeRange !== 'month' || selectedMonth || selectedYear) && (
                    <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs px-2 py-1">
                      <Calendar className="w-3 h-3 mr-1" />
                      <span className="truncate max-w-[100px] sm:max-w-[120px]">
                        {timeRange === 'specific_month' && selectedMonth && selectedYear && `${getMonthName(selectedMonth)} ${selectedYear}`}
                        {timeRange === 'specific_year' && selectedYear && selectedYear}
                        {timeRange === 'week' && '7 derniers jours'}
                        {timeRange === 'quarter' && '3 derniers mois'}
                        {timeRange === 'year' && 'Dernière année'}
                        {timeRange === 'month' && !selectedMonth && !selectedYear && '30 derniers jours'}
                      </span>
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Key Performance Indicators */}
        <div className="space-y-6">
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-2 bg-gradient-to-br from-emerald-100 to-emerald-200 rounded-lg">
              <Sparkles className="h-5 w-5 text-emerald-700" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Indicateurs Clés de Performance</h2>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-3 sm:gap-4">
            <KPICard
              title="Ouvriers Actifs"
              value={statistics.totalWorkers}
              subtitle={timeRange === 'specific_month' && selectedMonth && selectedYear ? `Entrés en ${getMonthName(selectedMonth)} ${selectedYear}` : timeRange === 'specific_year' && selectedYear ? `Entrés en ${selectedYear}` : "Total dans le système"}
              icon={Users}
              color="emerald"
              trend={{ value: Math.abs(statistics.workersTrend), isPositive: statistics.workersTrend > 0 }}
              onClick={() => navigate('/ouvriers')}
            />
            
            <KPICard
              title="Taux d'Occupation"
              value={`${statistics.occupancyRate}%`}
              subtitle={`${statistics.occupiedPlaces}/${statistics.totalCapacity} places`}
              icon={TrendingUp}
              color={statistics.isHighOccupancy ? "rose" : statistics.isLowOccupancy ? "amber" : "blue"}
              trend={{ value: Math.abs(statistics.occupancyTrend), isPositive: statistics.occupancyTrend > 0 }}
              onClick={() => navigate('/chambres')}
            />
            
            <KPICard
              title="Nouveaux Arrivants"
              value={statistics.recentArrivals}
              subtitle={timeRange === 'specific_month' && selectedMonth && selectedYear ? `${getMonthName(selectedMonth)} ${selectedYear}` : timeRange === 'specific_year' && selectedYear ? selectedYear : `${timeRange === 'week' ? '7' : timeRange === 'month' ? '30' : timeRange === 'quarter' ? '90' : '365'} derniers jours`}
              icon={UserCheck}
              color="purple"
              onClick={() => navigate('/ouvriers')}
            />

            <KPICard
              title="Sorties"
              value={statistics.recentExits}
              subtitle="Même période"
              icon={UserX}
              color="amber"
              onClick={() => navigate('/ouvriers')}
            />

            <KPICard
              title="Rétention"
              value={`${statistics.retentionRate}%`}
              subtitle="Taux de fidélisation"
              icon={Target}
              color={statistics.retentionRate > 85 ? "emerald" : statistics.retentionRate > 70 ? "blue" : "rose"}
              onClick={() => navigate('/ouvriers')}
            />

            <KPICard
              title="Durée Moyenne"
              value={`${statistics.averageStayDuration}j`}
              subtitle="Séjour moyen"
              icon={Clock}
              color="cyan"
              onClick={() => navigate('/ouvriers')}
            />
          </div>
        </div>

        {/* Detailed Analytics */}
        <Tabs defaultValue="overview" className="space-y-8">
          <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6 h-auto p-1 bg-white/80 backdrop-blur-sm border border-slate-200 shadow-sm">
            <TabsTrigger value="overview" className="flex flex-col lg:flex-row items-center p-4 lg:p-3 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-500 data-[state=active]:to-purple-600 data-[state=active]:text-white rounded-md">
              <BarChart className="h-4 w-4 mb-1 lg:mb-0 lg:mr-2" />
              <span className="text-xs lg:text-sm font-medium">Vue d'ensemble</span>
            </TabsTrigger>
            <TabsTrigger value="demographics" className="flex flex-col lg:flex-row items-center p-4 lg:p-3 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-500 data-[state=active]:to-purple-600 data-[state=active]:text-white rounded-md">
              <Users2 className="h-4 w-4 mb-1 lg:mb-0 lg:mr-2" />
              <span className="text-xs lg:text-sm font-medium">Démographie</span>
            </TabsTrigger>
            <TabsTrigger value="occupancy" className="flex flex-col lg:flex-row items-center p-4 lg:p-3 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-500 data-[state=active]:to-purple-600 data-[state=active]:text-white rounded-md">
              <Home className="h-4 w-4 mb-1 lg:mb-0 lg:mr-2" />
              <span className="text-xs lg:text-sm font-medium">Occupation</span>
            </TabsTrigger>
            <TabsTrigger value="performance" className="flex flex-col lg:flex-row items-center p-4 lg:p-3 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-500 data-[state=active]:to-purple-600 data-[state=active]:text-white rounded-md">
              <LineChart className="h-4 w-4 mb-1 lg:mb-0 lg:mr-2" />
              <span className="text-xs lg:text-sm font-medium">Performance</span>
            </TabsTrigger>
            <TabsTrigger value="workers" className="flex flex-col lg:flex-row items-center p-4 lg:p-3 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-500 data-[state=active]:to-purple-600 data-[state=active]:text-white rounded-md">
              <Users className="h-4 w-4 mb-1 lg:mb-0 lg:mr-2" />
              <span className="text-xs lg:text-sm font-medium">Ouvriers</span>
            </TabsTrigger>
            <TabsTrigger value="rooms" className="flex flex-col lg:flex-row items-center p-4 lg:p-3 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-500 data-[state=active]:to-purple-600 data-[state=active]:text-white rounded-md">
              <BedDouble className="h-4 w-4 mb-1 lg:mb-0 lg:mr-2" />
              <span className="text-xs lg:text-sm font-medium">Chambres</span>
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {/* Summary Metrics */}
              <MetricCard
                title="Total Fermes"
                value={selectedFerme === 'all' ? fermes.length : 1}
                subtitle={selectedFerme === 'all' ? "Fermes actives" : "Ferme sélectionnée"}
                icon={Building2}
                className="lg:col-span-1"
              />
              
              <MetricCard
                title="Chambres Disponibles"
                value={statistics.emptyRooms}
                subtitle={`sur ${statistics.totalRooms} chambres totales`}
                icon={BedDouble}
              />
              
              <MetricCard
                title="Places Libres"
                value={statistics.availablePlaces}
                subtitle="Disponibles immédiatement"
                icon={TrendingUp}
              />

              {/* Quick Insights */}
              <Card className="lg:col-span-2 xl:col-span-3 border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white">
                <CardHeader>
                  <CardTitle className="flex items-center text-lg">
                    <Activity className="mr-3 h-5 w-5 text-indigo-600" />
                    Insights Rapides
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className={`p-4 rounded-xl border ${statistics.hasRecentGrowth ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                      <div className="flex items-center mb-2">
                        {statistics.hasRecentGrowth ? 
                          <TrendingUp className="h-5 w-5 text-emerald-600 mr-2" /> :
                          <TrendingDown className="h-5 w-5 text-red-600 mr-2" />
                        }
                        <span className={`font-medium ${statistics.hasRecentGrowth ? 'text-emerald-900' : 'text-red-900'}`}>
                          {statistics.hasRecentGrowth ? 'Croissance' : 'Décroissance'}
                        </span>
                      </div>
                      <p className={`text-sm ${statistics.hasRecentGrowth ? 'text-emerald-800' : 'text-red-800'}`}>
                        {statistics.netChange > 0 ? '+' : ''}{statistics.netChange} ouvriers
                      </p>
                    </div>
                    
                    <div className={`p-4 rounded-xl border ${statistics.balancedGender ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'}`}>
                      <div className="flex items-center mb-2">
                        <Users className={`h-5 w-5 mr-2 ${statistics.balancedGender ? 'text-blue-600' : 'text-amber-600'}`} />
                        <span className={`font-medium ${statistics.balancedGender ? 'text-blue-900' : 'text-amber-900'}`}>
                          Équilibre Genre
                        </span>
                      </div>
                      <p className={`text-sm ${statistics.balancedGender ? 'text-blue-800' : 'text-amber-800'}`}>
                        {statistics.maleWorkers}H / {statistics.femaleWorkers}F
                      </p>
                    </div>
                    
                    <div className={`p-4 rounded-xl border ${statistics.isHighOccupancy ? 'bg-red-50 border-red-200' : statistics.isLowOccupancy ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
                      <div className="flex items-center mb-2">
                        <BedDouble className={`h-5 w-5 mr-2 ${statistics.isHighOccupancy ? 'text-red-600' : statistics.isLowOccupancy ? 'text-amber-600' : 'text-emerald-600'}`} />
                        <span className={`font-medium ${statistics.isHighOccupancy ? 'text-red-900' : statistics.isLowOccupancy ? 'text-amber-900' : 'text-emerald-900'}`}>
                          Occupation
                        </span>
                      </div>
                      <p className={`text-sm ${statistics.isHighOccupancy ? 'text-red-800' : statistics.isLowOccupancy ? 'text-amber-800' : 'text-emerald-800'}`}>
                        {statistics.occupancyRate}% - {statistics.isHighOccupancy ? 'Saturation' : statistics.isLowOccupancy ? 'Sous-utilisé' : 'Optimal'}
                      </p>
                    </div>
                    
                    <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
                      <div className="flex items-center mb-2">
                        <LogOut className="h-5 w-5 text-indigo-600 mr-2" />
                        <span className="font-medium text-indigo-900">Sortie Principal</span>
                      </div>
                      <p className="text-sm text-indigo-800">
                        {statistics.topExitReason} ({statistics.topExitReasonCount})
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Demographics Tab */}
          <TabsContent value="demographics" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Gender Distribution */}
              <Card className="border-0 shadow-sm bg-white">
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Users className="mr-2 h-5 w-5 text-indigo-600" />
                    Répartition par Genre
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-600">Hommes</span>
                      <div className="flex items-center space-x-2">
                        <Progress 
                          value={statistics.totalWorkers > 0 ? (statistics.maleWorkers / statistics.totalWorkers) * 100 : 0} 
                          className="w-32"
                        />
                        <span className="text-sm font-semibold text-slate-900 min-w-[4rem]">
                          {statistics.maleWorkers} ({statistics.totalWorkers > 0 ? Math.round((statistics.maleWorkers / statistics.totalWorkers) * 100) : 0}%)
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-600">Femmes</span>
                      <div className="flex items-center space-x-2">
                        <Progress 
                          value={statistics.totalWorkers > 0 ? (statistics.femaleWorkers / statistics.totalWorkers) * 100 : 0} 
                          className="w-32"
                        />
                        <span className="text-sm font-semibold text-slate-900 min-w-[4rem]">
                          {statistics.femaleWorkers} ({statistics.totalWorkers > 0 ? Math.round((statistics.femaleWorkers / statistics.totalWorkers) * 100) : 0}%)
                        </span>
                      </div>
                    </div>
                    <div className="pt-4 border-t border-slate-100 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Âge moyen:</span>
                        <span className="font-semibold">{statistics.averageAge} ans</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Étendue d'âge:</span>
                        <span className="font-semibold">{statistics.minAge} - {statistics.maxAge} ans</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Age Distribution */}
              <Card className="border-0 shadow-sm bg-white">
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <PieChart className="mr-2 h-5 w-5 text-purple-600" />
                    Distribution par Âge
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {Object.entries(statistics.ageDistribution).map(([range, count]) => (
                      <div key={range} className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-600">{range} ans</span>
                        <div className="flex items-center space-x-2">
                          <Progress 
                            value={statistics.totalWorkers > 0 ? (count / statistics.totalWorkers) * 100 : 0} 
                            className="w-24"
                          />
                          <span className="text-sm font-semibold text-slate-900 min-w-[3rem]">
                            {count} ({statistics.totalWorkers > 0 ? Math.round((count / statistics.totalWorkers) * 100) : 0}%)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Occupancy Tab */}
          <TabsContent value="occupancy" className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <MetricCard
                title="Chambres Totales"
                value={statistics.totalRooms}
                subtitle={`${statistics.maleRooms} hommes • ${statistics.femaleRooms} femmes`}
                icon={Home}
              />

              <MetricCard
                title="Chambres Occupées"
                value={statistics.occupiedRooms}
                subtitle={`${Math.round((statistics.occupiedRooms / statistics.totalRooms) * 100)}% du total`}
                icon={CheckCircle}
              />

              <MetricCard
                title="Chambres Vides"
                value={statistics.emptyRooms}
                subtitle="Disponibles immédiatement"
                icon={BedDouble}
              />

              <MetricCard
                title="Chambres Pleines"
                value={statistics.fullRooms}
                subtitle="À capacité maximale"
                icon={AlertTriangle}
              />
            </div>

            <Card className="border-0 shadow-sm bg-white">
              <CardHeader>
                <CardTitle>Analyse de Capacité</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span>Occupation Globale</span>
                      <span>{statistics.occupancyRate}%</span>
                    </div>
                    <Progress value={statistics.occupancyRate} className="h-3" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-slate-900">{statistics.totalCapacity}</div>
                      <div className="text-sm text-slate-600">Capacité totale</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-emerald-600">{statistics.occupiedPlaces}</div>
                      <div className="text-sm text-slate-600">Places occupées</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">{statistics.availablePlaces}</div>
                      <div className="text-sm text-slate-600">Places libres</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Performance Tab */}
          <TabsContent value="performance" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Retention & Turnover */}
              <Card className="border-0 shadow-sm bg-white">
                <CardHeader>
                  <CardTitle>Rétention et Rotation</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span>Taux de Rétention</span>
                        <span className="font-semibold">{statistics.retentionRate}%</span>
                      </div>
                      <Progress value={statistics.retentionRate} className="h-2" />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span>Taux de Rotation</span>
                        <span className="font-semibold">{statistics.turnoverRate}%</span>
                      </div>
                      <Progress value={statistics.turnoverRate} className="h-2" />
                    </div>
                    <div className="pt-2 border-t text-sm space-y-1">
                      <div className="flex justify-between">
                        <span>Durée moyenne de séjour:</span>
                        <span className="font-semibold">{statistics.averageStayDuration} jours</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Total sorties enregistrées:</span>
                        <span className="font-semibold">{statistics.totalExitedWorkers}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Exit Reasons */}
              <Card className="border-0 shadow-sm bg-white">
                <CardHeader>
                  <CardTitle>Analyse des Sorties</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {Object.entries(statistics.exitReasons)
                      .sort(([,a], [,b]) => b - a)
                      .slice(0, 5)
                      .map(([reason, count]) => (
                      <div key={reason} className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-600 capitalize">
                          {reason.replace('_', ' ')}
                        </span>
                        <div className="flex items-center space-x-2">
                          <Progress 
                            value={statistics.totalExitedWorkers > 0 ? (count / statistics.totalExitedWorkers) * 100 : 0} 
                            className="w-20"
                          />
                          <span className="text-sm font-semibold text-slate-900 min-w-[2rem]">
                            {count}
                          </span>
                        </div>
                      </div>
                    ))}
                    {Object.keys(statistics.exitReasons).length === 0 && (
                      <div className="text-center text-slate-500 py-4">
                        Aucune sortie enregistrée
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Workers Tab */}
          <TabsContent value="workers" className="space-y-6">
            <ResponsiveDataTable
              data={workers}
              columns={[
                { id: 'nom', header: 'Nom' },
                { id: 'prenom', header: 'Prénom' },
                { id: 'age', header: 'Âge' },
                { id: 'sexe', header: 'Genre' },
                { id: 'statut', header: 'Statut' },
                { id: 'chambre', header: 'Chambre' },
                { id: 'dateEntree', header: 'Date d\'entrée', type: 'date' },
              ]}
              searchPlaceholder="Rechercher un ouvrier..."
              title="Liste des Ouvriers"
              description={`${workers.length} ouvriers au total`}
            />
          </TabsContent>

          {/* Rooms Tab */}
          <TabsContent value="rooms" className="space-y-6">
            <ResponsiveDataTable
              data={rooms}
              columns={[
                { id: 'numero', header: 'Numéro' },
                { id: 'genre', header: 'Genre' },
                { id: 'capaciteTotale', header: 'Capacité' },
                { id: 'occupantsActuels', header: 'Occupants' },
                {
                  id: 'fermeId',
                  header: 'Ferme',
                  cell: (room: Room) => {
                    const ferme = fermes.find(f => f.id === room.fermeId);
                    return ferme ? ferme.nom : room.fermeId;
                  }
                },
              ]}
              searchPlaceholder="Rechercher une chambre..."
              title="Liste des Chambres"
              description={`${rooms.length} chambres au total`}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Export Options Dialog */}
      <Dialog open={showExportOptions} onOpenChange={setShowExportOptions}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <Download className="mr-2 h-5 w-5" />
              Options d'Export PDF
            </DialogTitle>
            <DialogDescription>
              Choisissez le type de rapport à générer
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Comprehensive Report */}
            <Card className="border-indigo-200 hover:bg-indigo-50 cursor-pointer transition-colors" onClick={handleComprehensiveExport}>
              <CardContent className="p-4">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-indigo-100 rounded-lg">
                    <BarChart3 className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Rapport Complet</h3>
                    <p className="text-sm text-gray-600">Toutes les fermes avec comparaisons</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Individual Farm Reports */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-gray-700">Rapports par Ferme</h4>
              {fermes.map(ferme => (
                <Card
                  key={ferme.id}
                  className="border-green-200 hover:bg-green-50 cursor-pointer transition-colors"
                  onClick={() => handleFermeExport(ferme.id)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center space-x-3">
                      <div className="p-1.5 bg-green-100 rounded-lg">
                        <Building2 className="h-4 w-4 text-green-600" />
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900">{ferme.nom}</h4>
                        <p className="text-xs text-gray-600">
                          {allWorkers.filter(w => w.fermeId === ferme.id && w.statut === 'actif').length} ouvriers •
                          {allRooms.filter(r => r.fermeId === ferme.id).length} chambres
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex justify-end space-x-2 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => setShowExportOptions(false)}
              >
                Annuler
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
