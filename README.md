
# EventFlow AI

### AI-Powered Event Planning & Proposal Management Platform

> EventFlow AI is an intelligent event planning platform that helps event planning companies streamline customer requests, generate AI-powered event proposals, manage budgets, and collaborate with customers through a structured human-in-the-loop approval workflow.

---

##  Team Information

| Field | Details |
|---|---|
| **Team Name** | NOVA |
| **Team Domain** | Domain 2 |
| **SDG Track (1–17)** | SDG 8 – Decent Work and Economic Growth |
| **Team Leader** | Jeanette Tan Le Han |
| **University** | Xiamen University Malaysia |
| **Number of Members** | 5 |

---

## Links

| Resource | Link |
|---|---|
| **GitHub Repository** | https://github.com/Joycemsan328/SDC_Hackathon.git |
| **Replit Project** | https://event-flow-ai-customer-portal.replit.app/login |
| **Live Demo** | https://drive.google.com/file/d/1Yh9t2PCvNx3yux0EqMu1KWfe2Omhc_FL/view?usp=drive_link |
| **RunPod Endpoint** | `POST https://api.runpod.ai/v2/v14dit7fdqpt7v/runsync` |
| **Slide Deck** | https://sg.docworkspace.com/d/sbQa3vWngAZ6nqFB_z4hmbox2rklizgpyf8?sa=601.1037 |
| **Demo Video** | https://youtu.be/XwEgB-vO9SI |
| **Product Requirements Document (PRD)** | [View PRD](./EventFlow%20AI%20PRD.pdf) |

---
## Demo Access & Login Instructions

**Live website:** https://event-flow-ai-customer-portal.replit.app/login

For hackathon evaluation, please use the team's existing demonstration accounts. **Newly registered Business accounts require approval from a Business Administrator before they can access the Business Portal.** Therefore, registering a new Business account may not provide immediate access during judging.

| Portal | Demo account email | Password |
|---|---|---|
| Business Portal | wangpaijoyce@gmail.com | joyce0328 |
| Customer Portal | yyiaan.e@gmail.com | 123456 |

**How to explore the demo:**

1. Open the live website using the link above.
2. Log in using the provided **Customer Portal** demo account to explore event creation, request tracking, and proposal review.
3. Log out and sign in using the provided **Business Portal** demo account to explore incoming requests, AI proposal review, and the approval workflow.
4. To observe the complete workflow, submit a customer event request, review the resulting proposals as a Business user, and return to the Customer Portal to view the approved options (subject to AI service availability).

**Why pre-approved accounts are provided:** Business account approval is an intentional role-based access control measure. It prevents unverified users from accessing business-level functions and customer requests. The supplied Business demo account has already completed the required approval process.

> **For judges:** The login passwords are supplied separately with the private submission materials. Please do not publish the passwords in a public GitHub README.

---

## Brief Overview

EventFlow AI connects customers and event planning companies through two role-specific portals backed by Supabase.

- **Customer Portal:** Customers can register or log in, create event requests, track request status, and review approved AI-generated proposals, including Plan A and Plan B. They can also submit change requests.
- **Business Portal:** Approved Business users can access customer requests, review AI-generated proposals, approve plans before customer viewing, and manage relevant event and supplier information.
- **AI-assisted workflow:** RunPod-hosted Qwen3-8B generates proposal options from customer requirements. Business review happens before proposals are shared with customers.

Customer registration and Business registration have different access requirements: Business users must receive administrator approval before using the Business Portal. Email verification and third-party sign-in behavior may depend on the current authentication configuration.

##  1. Problem Statement

Event planning is often a time-consuming and highly manual process.

Event planning companies must handle multiple customer inquiries, understand event requirements, prepare quotations, coordinate services, and manage revisions.

Traditional workflows frequently rely on spreadsheets, messaging applications, and manually prepared proposals.

### Key Challenges

- **Manual proposal preparation:** Event organisers spend significant time creating quotations and event plans.
- **Fragmented communication:** Customer requirements and feedback are scattered across different channels.
- **Budget management:** Preparing suitable event plans within a customer's budget requires repeated calculations and adjustments.
- **Slow revision cycles:** Changes to customer requirements often require proposals to be recreated manually.
- **Human error:** Manual workflows increase the risk of missed requirements, inconsistent quotations, and duplicated work.

These challenges reduce operational efficiency and affect the customer experience.

---

##  2. Proposed Solution

**EventFlow AI** is a web-based platform that combines AI-generated event proposals with a structured approval and revision process.

The platform connects customers and event planning companies through two dedicated portals.

### Customer Portal

Customers can:

1. Create an account and log in.
2. Select the Customer role.
3. Submit event requirements.
4. Specify event type, date, location, budget, and guest count.
5. Select required event services.
6. Track the status of submitted event requests.
7. Review approved AI-generated proposals.
8. Compare Plan A and Plan B.
9. Submit change requests when adjustments are needed.

### Business Portal

Event planning companies can:

1. Register and log in as a Business user.
2. Access a centralised business dashboard.
3. View incoming customer event requests.
4. Review AI-generated proposals.
5. Compare proposed services and estimated costs.
6. Approve proposals before sharing them with customers.
7. Review revised proposals after customer change requests.
8. Manage supplier information and event records.

### AI Proposal Generation

EventFlow AI integrates **Qwen3-8B through RunPod Serverless** to generate two event planning options based on customer requirements.

**Plan A – Budget-Conscious Option**

Focuses on cost efficiency while meeting the customer's essential event requirements.

**Plan B – Enhanced Experience Option**

Provides an alternative event arrangement with different service allocations, priorities, or enhanced features within the planning constraints.

Each proposal is designed to include:

- Event planning recommendations
- Service and item descriptions
- Estimated individual costs
- Total estimated budget in MYR
- Alternative planning options

AI-generated proposals are subject to human review before being presented to customers.

## Replit 
Replit allowed our team to develop, integrate, test, and deploy the application in a collaborative environment.

**How we used Replit:**
- **Frontend Development:** Built the Customer Portal and Business Portal, including event requests, proposal reviews, and approval workflows.
- **Backend Development:** Developed REST APIs using Node.js and Express to handle application requests, authentication, and AI proposal generation.
- **Database Integration:** Connected Supabase to manage customer accounts, event requests, AI-generated proposals, and approval statuses.
- **AI Integration:** Connected our backend to RunPod Serverless to generate personalized event proposals.
- **Testing and Debugging:** Tested application workflows, API endpoints, and frontend-backend integration.
- **Deployment:** Published EventFlow AI as a web application accessible through a browser.

Replit served as the **central platform connecting our frontend, backend, database, and AI services**.

## RunPod

We used **RunPod Serverless** to provide the AI computing infrastructure for EventFlow AI.

**How we used RunPod:**
- **AI Model Hosting:** Configured a RunPod Serverless endpoint to run Qwen3-8B using vLLM.
- **Automated Proposal Generation:** Sent structured event requirements from our backend to the AI model.
- **Personalized Recommendations:** Generated proposals based on the customer's event type, budget, guest count, location, selected services, and additional requirements.
- **Two Proposal Options:** Generated Plan A and Plan B, each containing suggested services, item descriptions, estimated prices, and total costs in MYR.
- **Budget-Aware Planning:** Structured the AI output to consider the customer's specified budget.
- **Human Review:** Allowed event planning businesses to review AI-generated proposals before approving them for customers.
- **Proposal Refinement:** Supported the workflow for generating revised proposals when customers submit change requests.

RunPod acts as the **AI inference engine**, while Replit hosts the application that sends requests and processes the generated results.

## 3. System Workflow

```text
              CUSTOMER
                 |
                 v
       Register / Login
                 |
                 v
        Create Event Request
                 |
                 v
       Save Event Information
            (Supabase)
                 |
                 v
       AI Proposal Generation
       (RunPod + Qwen3-8B)
                 |
                 v
          Plan A + Plan B
                 |
                 v
         BUSINESS REVIEW
                 |
          +------+------+
          |             |
       Approve       Revisions
          |             |
          |       Review Updated
          |          Proposal
          |             |
          +------+------+
                 |
                 v
        CUSTOMER REVIEW
                 |
          +------+------+
          |             |
       Accept       Request Changes
          |             |
          v             v
     Finalise       Regenerate AI
     Selection        Proposal
                        |
                        v
                   Business Review
```

The workflow keeps human decision-making at the centre of AI-assisted event planning.

---

##  4. Key Features

### 4.1 User Authentication and Role Selection

- Customer and Business account registration
- Email-based login
- Google sign-in where configured
- Role-based portal access
- Account-specific dashboard

### 4.2 Event Request Management

Customers can submit event requests with:

| Field | Description |
|---|---|
| Event Name | Name of the event |
| Event Type | Type of event being organised |
| Event Date | Planned event date |
| Location | Event venue or location |
| Guest Count | Estimated number of attendees |
| Budget | Customer's available budget |
| Theme | Preferred event style or theme |
| Services | Required event services |
| Requirements | Additional customer instructions |

### 4.3 AI-Generated Plan A and Plan B

- AI-assisted event planning
- Two alternative proposals
- Itemised estimated costs
- Budget-conscious recommendations
- Structured proposal output

### 4.4 Human-in-the-Loop Approval

AI does not independently finalise customer proposals.

Business users review the generated recommendations before approving them for customer viewing.

This helps maintain accountability and allows event organisers to assess the feasibility of AI-generated suggestions.

### 4.5 Change Request and Revision Workflow

Customers can request changes to an existing proposal.

The intended workflow is:

1. Customer submits a change request.
2. The request is saved.
3. AI generates revised Plan A and Plan B.
4. Business reviews the revised proposals.
5. Approved proposals become available to the customer.
6. The cycle continues until the customer accepts a proposal.

### 4.6 Supplier Information Management

Business users can manage supplier information through the platform.

Supplier records support proposal preparation and business planning.

The platform does not automatically contact or book suppliers.

---

##  5. Technology Stack

| Component | Technology | Purpose |
|---|---|---|
| Frontend | React, TypeScript | Interactive web application |
| Styling | Tailwind CSS | Responsive user interface |
| Backend | Node.js, Express | API and application logic |
| Database | Supabase (PostgreSQL) | Persistent application data |
| Authentication | Supabase Auth | User identity and access |
| AI Model | Qwen3-8B | Event proposal generation |
| AI Infrastructure | RunPod Serverless | AI model inference |
| Validation | Zod | Structured input and output validation |
| Development Platform | Replit | Development and deployment |
| Version Control | GitHub | Source code management |

---

##  6. AI Integration

### AI Model

**Qwen3-8B**

### AI Infrastructure

**RunPod Serverless**

### AI Processing Workflow

1. The customer submits an event request.
2. The backend validates the event information.
3. The backend sends a structured generation request to RunPod.
4. Qwen3-8B generates two event proposal options.
5. The backend validates the generated response.
6. Valid proposals are saved to the database.
7. Business users review and approve the proposals.
8. Customers view the approved proposals.

### Structured AI Output

Example of the intended proposal data structure:

```json
{
  "planA": {
    "name": "Budget-Conscious Plan",
    "items": [
      {
        "name": "Catering",
        "detail": "Buffet catering for guests",
        "price": 2500
      },
      {
        "name": "Decoration",
        "detail": "Basic event decoration",
        "price": 800
      }
    ],
    "total": 3300
  },
  "planB": {
    "name": "Enhanced Experience Plan",
    "items": [
      {
        "name": "Catering",
        "detail": "Premium buffet catering",
        "price": 3500
      },
      {
        "name": "Decoration",
        "detail": "Themed event decoration",
        "price": 1500
      }
    ],
    "total": 5000
  }
}
```

*The values above are illustrative and do not represent actual supplier quotations.*

### AI Safety and Reliability

The backend is designed to include:

- Server-side API key protection
- Request and response validation
- Structured proposal parsing
- Error handling
- Timeout handling
- Duplicate request protection
- Human review before customer approval

AI-generated prices are estimates and should be verified by event organisers.

---

## 7. How to Run the Project

### Prerequisites

Ensure the following tools are installed:

- Node.js
- pnpm
- Git

You will also need access to the configured Supabase and RunPod services for full functionality.

### Step 1: Clone the Repository

```bash
git clone https://github.com/Joycemsan328/SDC_Hackathon.git
cd SDC_Hackathon
```

### Step 2: Install Dependencies

```bash
pnpm install
```

### Step 3: Configure Environment Variables

Set the required environment variables using Replit Secrets or your local environment configuration.

Examples of required configuration include:

```env
RUNPOD_API_KEY=your_runpod_api_key
RUNPOD_ENDPOINT_ID=your_endpoint_id

SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

**Important:** Variable names may differ depending on the deployed application configuration. Check the repository's environment configuration before running.

Never commit API keys, service-role keys, or other private credentials to GitHub.

### Step 4: Start the Application

The project uses a pnpm workspace with multiple application components.

Use the development command configured for the active Replit application.

For the unified production build, the project uses:

```bash
pnpm -w run build:production
```

This command builds the production application; it does not itself start a development server.

For local development, refer to the workspace package scripts and Replit Run configuration for the appropriate start command.

### Step 5: Open the Website

Open the URL provided by Replit or the configured local development server.

### Step 6: Test the Workflow

1. Sign in using the provided Customer demo account (or register a new Customer account).
2. Create an event request.
3. Submit the event requirements.
4. Check whether AI proposal generation succeeds.
5. Log in using the pre-approved Business demo account (new Business registrations require administrator approval).
6. Review Plan A and Plan B.
7. Approve the proposal.
8. Return to the Customer Portal.
9. View the approved proposal.
10. Test the change request process.

**Note:** Live AI generation requires a configured RunPod endpoint, available credits, and the necessary production activation settings. Some features may not be available in every deployment.

---

## 8. Prototype Demonstration

The prototype demonstrates the main EventFlow AI user journey.

### Customer Journey

**Registration → Login → Create Event → Submit Request → View Proposal → Review Plan A/B**

### Business Journey

**Business Login → Dashboard → Incoming Requests → AI Proposals → Review → Approve**

### Prototype Screenshots

Add screenshots of the completed application here.

#### Customer Portal

<img width="1862" height="892" alt="image" src="https://github.com/user-attachments/assets/396c2589-7912-4627-8356-7727d4b744a2" />

#### Create Event

<img width="1577" height="886" alt="image" src="https://github.com/user-attachments/assets/b71a0eb8-dd75-4f72-b2fd-ed68e0e01c2d" />

#### Business Dashboard

<img width="1875" height="892" alt="image" src="https://github.com/user-attachments/assets/c698211d-2c99-4736-80b2-e64fc8cec8f9" />

#### AI Proposal Review

<img width="1863" height="900" alt="image" src="https://github.com/user-attachments/assets/c0a37b34-d57b-47f5-9216-926e5a12a837" />

---

## 9. SDG Alignment

### SDG 8 – Decent Work and Economic Growth

EventFlow AI aims to support productivity and digital transformation in the event planning industry.

The platform addresses repetitive administrative tasks and helps event planning companies organise their operations more efficiently.

### Potential Contributions

**Improved Productivity**

Automated proposal drafting may reduce the time required for event planning preparation.

**Digital Transformation**

Centralised workflows can help event planning businesses transition away from fragmented manual processes.

**Support for Small Businesses**

AI-assisted planning tools may help smaller event organisers manage customer inquiries and prepare proposals with fewer administrative resources.

**Human-AI Collaboration**

The approval workflow demonstrates how AI can support professional decision-making without replacing human oversight.

These are intended benefits and require further user testing and measurement.

---

## 10. Expected Impact

| Area | Expected Benefit |
|---|---|
| Operational Efficiency | Reduce repetitive proposal drafting |
| Customer Experience | Provide clearer proposal comparisons |
| Communication | Centralise event requests and revisions |
| Budget Planning | Generate structured estimated quotations |
| Business Productivity | Support event organisers with AI assistance |
| Accountability | Maintain human review and approval |

### Future Success Metrics

- Average time to prepare a proposal
- Number of revision cycles
- Proposal approval rate
- Customer satisfaction
- Accuracy of estimated costs
- AI generation success rate

---

## 11. Future Improvements

Future development opportunities include:

- More advanced budget optimisation
- Supplier quotation comparison
- Automated event timeline generation
- Proposal export to PDF
- Real-time notifications
- Improved AI personalisation
- Business analytics and reporting
- Multi-language support
- Additional testing and deployment monitoring

---

## 12. Limitations

EventFlow AI is a hackathon prototype and may have limitations.

- AI-generated quotations are estimates rather than confirmed supplier prices.
- Proposal accuracy depends on the information submitted by customers.
- AI generation requires an active RunPod service.
- AI output must be reviewed by business users.
- Some workflows may require additional testing before production use.
- Supplier records do not represent confirmed supplier availability.
- The prototype is not a complete commercial event booking system.

---

