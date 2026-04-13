import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import {
  PageHero,
  PageBody,
  Card,
  Button,
  Input,
  Select,
  Textarea,
  PageSkeleton,
} from "../../components/ui";

function ContactForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const queryClient = useQueryClient();
  const isEditMode = !!id;

  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    alternate_phone: "",
    address: "",
    city: "",
    contact_type: "individual",
    relationship_type: "borrower",
    is_handshake: false,
    notes: "",
  });

  const [errors, setErrors] = useState({});

  const { isLoading } = useQuery({
    queryKey: ["contact", id],
    queryFn: async () => {
      const response = await api.get(`/api/contacts/${id}`);
      const contact = response.data.contact || response.data;
      setFormData({
        name: contact.name || "",
        phone: contact.phone || "",
        alternate_phone: contact.alternate_phone || "",
        address: contact.address || "",
        city: contact.city || "",
        contact_type: contact.contact_type || "individual",
        relationship_type: contact.relationship_type || "borrower",
        is_handshake: contact.is_handshake || false,
        notes: contact.notes || "",
      });
      return contact;
    },
    enabled: isEditMode,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post("/api/contacts", data);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      navigate(`/contacts/${data.id}`);
    },
    onError: (error) => {
      if (error.response?.data?.detail) {
        setErrors({ submit: error.response.data.detail });
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.put(`/api/contacts/${id}`, data);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.removeQueries({ queryKey: ["contact", String(id)] });
      queryClient.removeQueries({ queryKey: ["contact", id] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      navigate(`/contacts/${data.id || id}`);
    },
    onError: (error) => {
      if (error.response?.data?.detail) {
        setErrors({ submit: error.response.data.detail });
      }
    },
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = "Name is required";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    const submitData = {
      name: formData.name.trim(),
      phone: formData.phone?.trim() || null,
      alternate_phone: formData.alternate_phone?.trim() || null,
      address: formData.address?.trim() || null,
      city: formData.city?.trim() || null,
      contact_type: formData.contact_type,
      relationship_type: formData.relationship_type,
      is_handshake: formData.is_handshake,
      notes: formData.notes?.trim() || null,
    };

    if (isEditMode) updateMutation.mutate(submitData);
    else createMutation.mutate(submitData);
  };

  if (isLoading) return <PageSkeleton />;

  const labelClass = "text-[11px] font-semibold text-slate-500 uppercase tracking-widest";

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title={isEditMode ? "Edit Contact" : "New Contact"}
        subtitle={isEditMode ? "Update contact information" : "Add a new contact to your network"}
        backTo="/contacts"
        compact
      />

      <PageBody>
        <Card className="max-w-3xl p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {errors.submit && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm">
                {errors.submit}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Input
                label="Name *"
                name="name"
                value={formData.name}
                onChange={handleChange}
                error={errors.name}
                placeholder="Enter contact name"
                className="sm:col-span-2"
                labelClassName={labelClass}
              />

              <Input
                label="Phone"
                name="phone"
                type="tel"
                value={formData.phone}
                onChange={handleChange}
                placeholder="+91 98765 43210"
                labelClassName={labelClass}
              />

              <Input
                label="Alternate Phone"
                name="alternate_phone"
                type="tel"
                value={formData.alternate_phone}
                onChange={handleChange}
                placeholder="+91 98765 43210"
                labelClassName={labelClass}
              />

              <Select
                label="Contact Type"
                name="contact_type"
                value={formData.contact_type}
                onChange={handleChange}
                labelClassName={labelClass}
              >
                <option value="individual">Individual</option>
                <option value="institution">Institution</option>
              </Select>

              <Select
                label="Relationship Type"
                name="relationship_type"
                value={formData.relationship_type}
                onChange={handleChange}
                labelClassName={labelClass}
              >
                <option value="borrower">Borrower</option>
                <option value="lender">Lender</option>
                <option value="partner">Partner</option>
                <option value="agent">Agent</option>
                <option value="buyer">Buyer</option>
                <option value="seller">Seller</option>
                <option value="mixed">Mixed</option>
              </Select>

              <Input
                label="City"
                name="city"
                value={formData.city}
                onChange={handleChange}
                placeholder="Enter city"
                labelClassName={labelClass}
              />

              <div className="flex items-center gap-3 pt-6">
                <input
                  type="checkbox"
                  id="is_handshake"
                  checked={formData.is_handshake}
                  onChange={(e) => setFormData((prev) => ({ ...prev, is_handshake: e.target.checked }))}
                  className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                />
                <label htmlFor="is_handshake" className="text-sm font-medium text-slate-700">
                  Handshake Deal (Trust-based)
                </label>
              </div>
            </div>

            <Textarea
              label="Address"
              name="address"
              value={formData.address}
              onChange={handleChange}
              rows="2"
              placeholder="Enter full address"
              labelClassName={labelClass}
            />

            <Textarea
              label="Notes"
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows="3"
              placeholder="Add any additional notes"
              labelClassName={labelClass}
            />

            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate("/contacts")}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="flex-1"
              >
                {createMutation.isPending || updateMutation.isPending
                  ? "Saving..."
                  : isEditMode
                    ? "Update Contact"
                    : "Create Contact"}
              </Button>
            </div>
          </form>
        </Card>
      </PageBody>
    </div>
  );
}

export default ContactForm;
