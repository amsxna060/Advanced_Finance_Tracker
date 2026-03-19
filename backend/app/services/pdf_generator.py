"""
PDF Generation Service using ReportLab
Generates professional financial reports with proper formatting
"""
from datetime import datetime
from typing import List, Dict, Any
from io import BytesIO
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak
from reportlab.platypus import Image as RLImage
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT


class PDFReportGenerator:
    """Generate various financial reports in PDF format"""
    
    def __init__(self):
        self.styles = getSampleStyleSheet()
        self._setup_custom_styles()
    
    def _setup_custom_styles(self):
        """Setup custom paragraph styles"""
        self.styles.add(ParagraphStyle(
            name='CustomTitle',
            parent=self.styles['Heading1'],
            fontSize=24,
            textColor=colors.HexColor('#1e40af'),
            spaceAfter=30,
            alignment=TA_CENTER
        ))
        
        self.styles.add(ParagraphStyle(
            name='SectionHeader',
            parent=self.styles['Heading2'],
            fontSize=14,
            textColor=colors.HexColor('#1e40af'),
            spaceAfter=12,
            spaceBefore=12
        ))
        
        self.styles.add(ParagraphStyle(
            name='RightAlign',
            parent=self.styles['Normal'],
            alignment=TA_RIGHT
        ))
    
    def _format_currency(self, amount: float) -> str:
        """Format amount as currency"""
        return f"₹{amount:,.2f}"
    
    def _format_date(self, date) -> str:
        """Format date"""
        if isinstance(date, str):
            return date
        return date.strftime('%d-%b-%Y') if date else 'N/A'
    
    def generate_loan_statement(self, loan_data: Dict[str, Any], payments: List[Dict[str, Any]]) -> BytesIO:
        """Generate comprehensive loan statement PDF"""
        buffer = BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=72, leftMargin=72,
                                topMargin=72, bottomMargin=18)
        
        story = []
        
        # Title
        story.append(Paragraph("LOAN STATEMENT", self.styles['CustomTitle']))
        story.append(Spacer(1, 0.2*inch))
        
        # Loan Details Section
        story.append(Paragraph("Loan Details", self.styles['SectionHeader']))
        
        loan_info = [
            ['Loan ID:', str(loan_data.get('id', 'N/A'))],
            ['Contact:', loan_data.get('contact_name', 'N/A')],
            ['Principal Amount:', self._format_currency(loan_data.get('principal', 0))],
            ['Interest Rate:', f"{loan_data.get('interest_rate', 0)}% per annum"],
            ['Start Date:', self._format_date(loan_data.get('start_date'))],
            ['Tenure:', f"{loan_data.get('tenure_months', 0)} months"],
            ['Status:', loan_data.get('status', 'N/A').upper()],
        ]
        
        loan_table = Table(loan_info, colWidths=[2*inch, 4*inch])
        loan_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#e5e7eb')),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
            ('ALIGN', (0, 0), (0, -1), 'RIGHT'),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ]))
        story.append(loan_table)
        story.append(Spacer(1, 0.3*inch))
        
        # Financial Summary
        story.append(Paragraph("Financial Summary", self.styles['SectionHeader']))
        
        summary_data = [
            ['Total Outstanding:', self._format_currency(loan_data.get('outstanding', 0))],
            ['Principal Outstanding:', self._format_currency(loan_data.get('principal_outstanding', 0))],
            ['Interest Outstanding:', self._format_currency(loan_data.get('interest_outstanding', 0))],
            ['Total Paid:', self._format_currency(loan_data.get('total_paid', 0))],
            ['Overdue Amount:', self._format_currency(loan_data.get('overdue_amount', 0))],
        ]
        
        summary_table = Table(summary_data, colWidths=[3*inch, 3*inch])
        summary_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#e5e7eb')),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ]))
        story.append(summary_table)
        story.append(Spacer(1, 0.3*inch))
        
        # Payment History
        if payments:
            story.append(Paragraph("Payment History", self.styles['SectionHeader']))
            
            payment_data = [['Date', 'Type', 'Principal', 'Interest', 'Total', 'Balance']]
            
            for payment in payments:
                payment_data.append([
                    self._format_date(payment.get('payment_date')),
                    payment.get('payment_type', 'N/A').upper(),
                    self._format_currency(payment.get('principal_amount', 0)),
                    self._format_currency(payment.get('interest_amount', 0)),
                    self._format_currency(payment.get('total_amount', 0)),
                    self._format_currency(payment.get('outstanding_after', 0)),
                ])
            
            payment_table = Table(payment_data, colWidths=[1.2*inch, 1*inch, 1.1*inch, 1.1*inch, 1.1*inch, 1.1*inch])
            payment_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e40af')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                ('ALIGN', (2, 0), (-1, -1), 'RIGHT'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 9),
                ('FONTSIZE', (0, 1), (-1, -1), 8),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                ('TOPPADDING', (0, 0), (-1, -1), 6),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f3f4f6')]),
            ]))
            story.append(payment_table)
        
        story.append(Spacer(1, 0.5*inch))
        
        # Footer
        footer_text = f"Generated on: {datetime.now().strftime('%d-%b-%Y %I:%M %p')}"
        story.append(Paragraph(footer_text, self.styles['RightAlign']))
        
        doc.build(story)
        buffer.seek(0)
        return buffer
    
    def generate_portfolio_summary(self, summary_data: Dict[str, Any]) -> BytesIO:
        """Generate portfolio summary report PDF"""
        buffer = BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=72, leftMargin=72,
                                topMargin=72, bottomMargin=18)
        
        story = []
        
        # Title
        story.append(Paragraph("PORTFOLIO SUMMARY REPORT", self.styles['CustomTitle']))
        story.append(Spacer(1, 0.2*inch))
        
        # Report Period
        report_date = datetime.now().strftime('%d %B %Y')
        story.append(Paragraph(f"As of: {report_date}", self.styles['RightAlign']))
        story.append(Spacer(1, 0.3*inch))
        
        # Lending Portfolio
        story.append(Paragraph("Lending Portfolio", self.styles['SectionHeader']))
        
        lending_data = [
            ['Total Lent Out:', self._format_currency(summary_data.get('total_lent_out', 0))],
            ['Outstanding Receivables:', self._format_currency(summary_data.get('total_outstanding_receivable', 0))],
            ['Expected This Month:', self._format_currency(summary_data.get('expected_this_month', 0))],
            ['Total Overdue:', self._format_currency(summary_data.get('total_overdue', 0))],
        ]
        
        lending_table = Table(lending_data, colWidths=[3*inch, 3*inch])
        lending_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#dbeafe')),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 11),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 10),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ]))
        story.append(lending_table)
        story.append(Spacer(1, 0.3*inch))
        
        # Borrowing Portfolio
        story.append(Paragraph("Borrowing Portfolio", self.styles['SectionHeader']))
        
        borrowing_data = [
            ['Total Borrowed:', self._format_currency(summary_data.get('total_borrowed', 0))],
            ['Outstanding Payables:', self._format_currency(summary_data.get('total_outstanding_payable', 0))],
        ]
        
        borrowing_table = Table(borrowing_data, colWidths=[3*inch, 3*inch])
        borrowing_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#fef3c7')),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 11),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 10),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ]))
        story.append(borrowing_table)
        story.append(Spacer(1, 0.3*inch))
        
        # Net Position
        story.append(Paragraph("Net Position", self.styles['SectionHeader']))
        
        net_position = summary_data.get('net_position', 0)
        net_color = colors.HexColor('#dcfce7') if net_position >= 0 else colors.HexColor('#fee2e2')
        
        net_data = [
            ['Net Position:', self._format_currency(net_position)],
        ]
        
        net_table = Table(net_data, colWidths=[3*inch, 3*inch])
        net_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), net_color),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 12),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
            ('TOPPADDING', (0, 0), (-1, -1), 12),
            ('GRID', (0, 0), (-1, -1), 1, colors.grey),
        ]))
        story.append(net_table)
        story.append(Spacer(1, 0.3*inch))
        
        # Other Investments
        story.append(Paragraph("Other Investments", self.styles['SectionHeader']))
        
        other_data = [
            ['Active Property Deals:', str(summary_data.get('active_property_deals', 0))],
            ['Active Partnerships:', str(summary_data.get('active_partnerships', 0))],
        ]
        
        other_table = Table(other_data, colWidths=[3*inch, 3*inch])
        other_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#e5e7eb')),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 11),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 10),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ]))
        story.append(other_table)
        
        story.append(Spacer(1, 0.5*inch))
        
        # Footer
        footer_text = f"Generated on: {datetime.now().strftime('%d-%b-%Y %I:%M %p')}"
        story.append(Paragraph(footer_text, self.styles['RightAlign']))
        
        doc.build(story)
        buffer.seek(0)
        return buffer
    
    def generate_pnl_report(self, start_date: datetime, end_date: datetime, 
                           income_data: List[Dict], expense_data: List[Dict]) -> BytesIO:
        """Generate Profit & Loss statement PDF"""
        buffer = BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=72, leftMargin=72,
                                topMargin=72, bottomMargin=18)
        
        story = []
        
        # Title
        story.append(Paragraph("PROFIT & LOSS STATEMENT", self.styles['CustomTitle']))
        story.append(Spacer(1, 0.2*inch))
        
        # Report Period
        period_text = f"Period: {self._format_date(start_date)} to {self._format_date(end_date)}"
        story.append(Paragraph(period_text, self.styles['RightAlign']))
        story.append(Spacer(1, 0.3*inch))
        
        # Income Section
        story.append(Paragraph("Income", self.styles['SectionHeader']))
        
        total_income = sum(item.get('amount', 0) for item in income_data)
        
        income_rows = [['Category', 'Amount']]
        for item in income_data:
            income_rows.append([
                item.get('category', 'N/A').capitalize(),
                self._format_currency(item.get('amount', 0))
            ])
        income_rows.append(['Total Income', self._format_currency(total_income)])
        
        income_table = Table(income_rows, colWidths=[3*inch, 3*inch])
        income_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e40af')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#dbeafe')),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ]))
        story.append(income_table)
        story.append(Spacer(1, 0.3*inch))
        
        # Expense Section
        story.append(Paragraph("Expenses", self.styles['SectionHeader']))
        
        total_expense = sum(item.get('amount', 0) for item in expense_data)
        
        expense_rows = [['Category', 'Amount']]
        for item in expense_data:
            expense_rows.append([
                item.get('category', 'N/A').capitalize(),
                self._format_currency(item.get('amount', 0))
            ])
        expense_rows.append(['Total Expenses', self._format_currency(total_expense)])
        
        expense_table = Table(expense_rows, colWidths=[3*inch, 3*inch])
        expense_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#991b1b')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#fee2e2')),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ]))
        story.append(expense_table)
        story.append(Spacer(1, 0.3*inch))
        
        # Net Profit/Loss
        story.append(Paragraph("Summary", self.styles['SectionHeader']))
        
        net_pnl = total_income - total_expense
        net_color = colors.HexColor('#dcfce7') if net_pnl >= 0 else colors.HexColor('#fee2e2')
        net_label = 'Net Profit' if net_pnl >= 0 else 'Net Loss'
        
        summary_data = [
            ['Total Income:', self._format_currency(total_income)],
            ['Total Expenses:', self._format_currency(total_expense)],
            [net_label + ':', self._format_currency(abs(net_pnl))],
        ]
        
        summary_table = Table(summary_data, colWidths=[3*inch, 3*inch])
        summary_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, 1), colors.HexColor('#e5e7eb')),
            ('BACKGROUND', (0, 2), (-1, 2), net_color),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTNAME', (0, 2), (-1, 2), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 1), 11),
            ('FONTSIZE', (0, 2), (-1, 2), 12),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 10),
            ('GRID', (0, 0), (-1, -1), 1, colors.grey),
        ]))
        story.append(summary_table)
        
        story.append(Spacer(1, 0.5*inch))
        
        # Footer
        footer_text = f"Generated on: {datetime.now().strftime('%d-%b-%Y %I:%M %p')}"
        story.append(Paragraph(footer_text, self.styles['RightAlign']))
        
        doc.build(story)
        buffer.seek(0)
        return buffer
